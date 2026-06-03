/**
 * Operator routes for per-repository merge-gate/grading/guardrail config (BKL-013 PR3).
 *
 * Security: GET is open to any authenticated caller; PUT/DELETE are operator-only
 * (requireNotAgentService — agents can never edit their own merge gate, per ADR-001).
 *
 * Routes:
 *   GET  /api/repositories/:name/gate-config       → { defaults, overrides, effective }
 *   PUT  /api/repositories/:name/gate-config       → save sparse overrides (operator only)
 *   DELETE /api/repositories/:name/gate-config     → reset to DEFAULT_PRESET (operator only)
 */

import express, { type Request, type Response } from "express";
import { requireNotAgentService } from "../auth";
import { logger } from "../logger";
import {
  DEFAULT_PRESET,
  deleteRepoGateConfig,
  GATE_CONFIDENCE_LEVELS,
  getStoredRepoGateConfig,
  POLICY_BOUNDS,
  type RepoGateConfig,
  resolveEffectiveGateConfig,
  setRepoGateConfig,
} from "../repo-gate-store";
import type { AuthenticatedRequest } from "../types";
import { sanitizeRepoName } from "../validation";

// ─── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a sparse overrides object. Throws a descriptive string on invalid input.
 * Only validates fields that are present (sparse → absent = inherit default).
 */
function validateOverrides(input: unknown): Partial<RepoGateConfig> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw "overrides must be a non-null object";
  }
  const obj = input as Record<string, unknown>;

  if ("autoMergeThreshold" in obj) {
    if (!GATE_CONFIDENCE_LEVELS.includes(obj.autoMergeThreshold as never)) {
      throw `autoMergeThreshold must be one of: ${GATE_CONFIDENCE_LEVELS.join(", ")}`;
    }
  }

  if ("mergePolicy" in obj) {
    if (!obj.mergePolicy || typeof obj.mergePolicy !== "object" || Array.isArray(obj.mergePolicy)) {
      throw "mergePolicy must be an object";
    }
    const mp = obj.mergePolicy as Record<string, unknown>;
    for (const level of Object.keys(mp)) {
      if (!GATE_CONFIDENCE_LEVELS.includes(level as never)) {
        throw `mergePolicy key '${level}' is not a valid confidence level`;
      }
      const entry = mp[level] as Record<string, unknown>;
      if (typeof entry.allowed !== "boolean") throw `mergePolicy.${level}.allowed must be a boolean`;
      if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
        throw `mergePolicy.${level}.reason must be a non-empty string`;
      }
    }
  }

  if ("prSize" in obj && obj.prSize) {
    const ps = obj.prSize as Record<string, unknown>;
    if ("maxLines" in ps) {
      const v = Number(ps.maxLines);
      if (!Number.isInteger(v) || v < POLICY_BOUNDS.minLines || v > POLICY_BOUNDS.maxLines) {
        throw `prSize.maxLines must be an integer between ${POLICY_BOUNDS.minLines} and ${POLICY_BOUNDS.maxLines}`;
      }
    }
    if ("maxFiles" in ps) {
      const v = Number(ps.maxFiles);
      if (!Number.isInteger(v) || v < POLICY_BOUNDS.minFiles || v > POLICY_BOUNDS.maxFiles) {
        throw `prSize.maxFiles must be an integer between ${POLICY_BOUNDS.minFiles} and ${POLICY_BOUNDS.maxFiles}`;
      }
    }
  }

  if ("grading" in obj && obj.grading) {
    const g = obj.grading as Record<string, unknown>;
    if (g.weights) {
      const w = g.weights as Record<string, unknown>;
      for (const key of ["clarity", "confidence", "blastRadius"] as const) {
        if (key in w) {
          const v = Number(w[key]);
          if (Number.isNaN(v) || v < POLICY_BOUNDS.minWeight || v > POLICY_BOUNDS.maxWeight) {
            throw `grading.weights.${key} must be a number between ${POLICY_BOUNDS.minWeight} and ${POLICY_BOUNDS.maxWeight}`;
          }
        }
      }
    }
  }

  return obj as Partial<RepoGateConfig>;
}

// ─── Route factory ─────────────────────────────────────────────────────────────

export function createRepoGateConfigRouter() {
  const router = express.Router();

  /**
   * GET /api/repositories/:name/gate-config
   * Returns the defaults, stored overrides, and resolved effective config for a repo.
   * Readable by any authenticated caller (agents may read the policy they're subject to).
   */
  router.get("/api/repositories/:name/gate-config", (req: Request, res: Response) => {
    const rawName = req.params.name as string;
    const repoName = sanitizeRepoName(rawName);
    if (repoName !== rawName) {
      res.status(400).json({ error: "Invalid repository name" });
      return;
    }

    const stored = getStoredRepoGateConfig(repoName);
    const effective = resolveEffectiveGateConfig(repoName);

    res.json({
      defaults: DEFAULT_PRESET,
      overrides: stored?.overrides ?? {},
      effective,
      updatedAt: stored?.updatedAt ?? null,
      updatedBy: stored?.updatedBy ?? null,
    });
  });

  /**
   * PUT /api/repositories/:name/gate-config
   * Save sparse overrides for a repo. Operator-only (agent-service tokens → 403).
   * Body: partial RepoGateConfig (only changed fields).
   */
  router.put("/api/repositories/:name/gate-config", requireNotAgentService, async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    const rawName = req.params.name as string;
    const repoName = sanitizeRepoName(rawName);
    if (repoName !== rawName) {
      res.status(400).json({ error: "Invalid repository name" });
      return;
    }

    let overrides: Partial<RepoGateConfig>;
    try {
      overrides = validateOverrides(req.body);
    } catch (msg) {
      res.status(400).json({ error: String(msg) });
      return;
    }

    // Warn on loosening the critical level (allowed per ADR-001, but loud audit)
    const mp = overrides.mergePolicy as Record<string, { allowed?: boolean }> | undefined;
    if (mp?.critical?.allowed === true) {
      logger.warn(
        `[AUDIT] Repo gate config: critical-confidence merge enabled for '${repoName}' by ${user?.sub ?? "unknown"}`,
      );
    }

    const stored = await setRepoGateConfig(repoName, overrides, user?.sub ?? "unknown");
    logger.info(`[AUDIT] Repo gate config update for '${repoName}' by ${user?.sub ?? "unknown"}`);

    const effective = resolveEffectiveGateConfig(repoName);
    res.json({
      defaults: DEFAULT_PRESET,
      overrides: stored.overrides,
      effective,
      updatedAt: stored.updatedAt,
      updatedBy: stored.updatedBy,
    });
  });

  /**
   * DELETE /api/repositories/:name/gate-config
   * Reset a repo to DEFAULT_PRESET by removing its stored overrides. Operator-only.
   */
  router.delete("/api/repositories/:name/gate-config", requireNotAgentService, (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    const rawName = req.params.name as string;
    const repoName = sanitizeRepoName(rawName);
    if (repoName !== rawName) {
      res.status(400).json({ error: "Invalid repository name" });
      return;
    }

    deleteRepoGateConfig(repoName);
    logger.info(`[AUDIT] Repo gate config reset for '${repoName}' by ${user?.sub ?? "unknown"}`);

    res.json({
      defaults: DEFAULT_PRESET,
      overrides: {},
      effective: DEFAULT_PRESET,
      updatedAt: null,
      updatedBy: null,
    });
  });

  return router;
}
