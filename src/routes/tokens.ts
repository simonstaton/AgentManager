import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express, { type Response } from "express";
import { requireNotAgentService } from "../auth";
import { logger } from "../logger";
import { debouncedSyncToGCS } from "../storage";
import {
  deleteToken,
  getTokenStatuses,
  KNOWN_SERVICES,
  loadToken,
  SERVICE_TO_ENV,
  saveUIToken,
} from "../token-storage";
import { validateToken } from "../token-validation";
import type { AuthenticatedRequest } from "../types";
import { errorMessage } from "../types";

const execFileAsync = promisify(execFile);

/** Re-run MCP bootstrap to regenerate ~/.claude/settings.json after token changes. */
async function rebootstrapMcp(): Promise<void> {
  try {
    await execFileAsync("node", ["scripts/mcp-bootstrap.js"], {
      cwd: process.cwd(),
      timeout: 10_000,
      env: process.env,
    });
    logger.info("[tokens] MCP settings re-bootstrapped after token change");
  } catch (err: unknown) {
    logger.warn(`[tokens] Failed to re-bootstrap MCP settings: ${errorMessage(err)}`);
  }
}

export function createTokensRouter() {
  const router = express.Router();

  /**
   * GET /api/tokens
   * List all integration token statuses (never returns raw token values)
   */
  router.get("/api/tokens", (_req, res: Response) => {
    try {
      const statuses = getTokenStatuses();
      res.json({ tokens: statuses });
    } catch (err: unknown) {
      logger.error(`[tokens] Failed to list tokens: ${errorMessage(err)}`);
      res.status(500).json({ error: "Failed to list token statuses" });
    }
  });

  /**
   * PUT /api/tokens/:service
   * Set or update a token for a service.
   * Body: { token: string, label?: string }
   * Query: ?validate=true (default) to validate before saving
   */
  router.put("/api/tokens/:service", requireNotAgentService, async (req, res: Response) => {
    const service = req.params.service as string;
    if (!KNOWN_SERVICES.has(service)) {
      res.status(400).json({ error: `Unknown service: ${service}. Valid services: ${[...KNOWN_SERVICES].join(", ")}` });
      return;
    }

    const { token, label } = req.body ?? {};
    if (!token || typeof token !== "string" || token.trim().length < 4) {
      res.status(400).json({ error: "A valid token string is required" });
      return;
    }

    const trimmedToken = token.trim();
    const shouldValidate = req.query.validate !== "false";

    let validatedUser: string | undefined;
    let validationWarning: string | undefined;

    if (shouldValidate) {
      const result = await validateToken(service, trimmedToken);
      if (!result.valid) {
        validationWarning = result.error || "Token validation failed";
        logger.warn(
          `[AUDIT] Token for ${service} set with validation warning by user: ${(req as AuthenticatedRequest).user?.sub ?? "unknown"} — ${validationWarning}`,
        );
      } else {
        validatedUser = result.user;
      }
    }

    try {
      saveUIToken(service, trimmedToken, { label: typeof label === "string" ? label : undefined, validatedUser });
      await rebootstrapMcp();
      debouncedSyncToGCS();

      logger.warn(`[AUDIT] Token for ${service} set by user: ${(req as AuthenticatedRequest).user?.sub ?? "unknown"}`);

      const stored = loadToken(service);
      res.json({
        ok: true,
        service,
        source: "ui",
        hint: `...${trimmedToken.slice(-4)}`,
        user: validatedUser,
        label: stored?.label,
        validationWarning,
      });
    } catch (err: unknown) {
      logger.error(`[tokens] Failed to save token for ${service}: ${errorMessage(err)}`);
      res.status(500).json({ error: "Failed to save token" });
    }
  });

  /**
   * DELETE /api/tokens/:service
   * Remove a UI-set token for a service. Falls back to env var.
   */
  router.delete("/api/tokens/:service", requireNotAgentService, async (req, res: Response) => {
    const service = req.params.service as string;
    if (!KNOWN_SERVICES.has(service)) {
      res.status(400).json({ error: `Unknown service: ${service}` });
      return;
    }

    try {
      deleteToken(service);
      await rebootstrapMcp();
      debouncedSyncToGCS();

      logger.warn(
        `[AUDIT] Token for ${service} removed by user: ${(req as AuthenticatedRequest).user?.sub ?? "unknown"}`,
      );

      const envKey = SERVICE_TO_ENV[service];
      const hasFallback = envKey ? !!process.env[envKey] : false;

      res.json({ ok: true, service, hasFallback });
    } catch (err: unknown) {
      logger.error(`[tokens] Failed to delete token for ${service}: ${errorMessage(err)}`);
      res.status(500).json({ error: "Failed to delete token" });
    }
  });

  return router;
}
