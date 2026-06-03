import crypto from "node:crypto";
import express, { type Response } from "express";
import { requireNotAgentService, requireNotPendingToken, signUserToken, verifyPendingToken } from "../auth";
import { logger } from "../logger";
import {
  confirmTotpSetup,
  disableTotp,
  isTotpEnabled,
  loadDecryptedSecret,
  loadTotpConfig,
  prepareTotpSetup,
  regenerateBackupCodes,
  saveTotpConfig,
  verifyAndConsumeBackupCode,
  verifyTotpCode,
} from "../totp";
import type { AuthenticatedRequest } from "../types";
import { errorMessage } from "../types";

/** Sanitize a TOTP code by stripping whitespace. */
function sanitizeCode(code: string): string {
  return code.replace(/\s/g, "");
}

/**
 * Verify a code against the current TOTP secret, falling back to backup codes.
 * Returns true if verified. If a backup code is consumed, the config is updated.
 */
function verifyCodeWithBackupFallback(code: string): boolean {
  const secret = loadDecryptedSecret();
  if (secret && verifyTotpCode(secret, sanitizeCode(code))) {
    return true;
  }
  const config = loadTotpConfig();
  if (config?.backupCodes?.length) {
    const result = verifyAndConsumeBackupCode(code, config.backupCodes);
    if (result) {
      saveTotpConfig({ ...config, backupCodes: result.remaining });
      logger.warn(`[AUDIT] TOTP backup code used — codes remaining: ${result.remaining.length}`);
      return true;
    }
  }
  return false;
}

// ── Rate limiting for TOTP verify ─────────────────────────────────────────────
// Keyed by SHA-256 of the pending token to avoid holding raw tokens in memory.
// Each entry tracks failures; after MAX_FAILURES the token is blacklisted until
// it naturally expires (5 min) or the server restarts.

interface VerifyAttempt {
  failures: number;
  blacklistedAt: number | null;
}

const verifyAttempts = new Map<string, VerifyAttempt>();
const MAX_VERIFY_FAILURES = 10;

function verifyRateLimitKey(pendingToken: string): string {
  return crypto.createHash("sha256").update(pendingToken).digest("hex");
}

function isVerifyBlocked(key: string): boolean {
  const entry = verifyAttempts.get(key);
  return entry?.blacklistedAt !== null && entry !== undefined && entry.failures >= MAX_VERIFY_FAILURES;
}

function recordVerifyFailure(key: string): void {
  const entry = verifyAttempts.get(key) ?? { failures: 0, blacklistedAt: null };
  entry.failures += 1;
  if (entry.failures >= MAX_VERIFY_FAILURES) {
    entry.blacklistedAt = Date.now();
    logger.warn(`[AUDIT][totp] Verify rate limit reached — token blacklisted`);
  }
  verifyAttempts.set(key, entry);
}

function clearVerifyAttempts(key: string): void {
  verifyAttempts.delete(key);
}

export function createTotpRouter() {
  const router = express.Router();

  /**
   * POST /api/auth/totp/verify
   * Step 2 of login: verify TOTP code (or backup code) and exchange pending token for full JWT.
   * Body: { pendingToken, code }
   * Does NOT require a full JWT — the pending token is validated directly here.
   */
  router.post("/api/auth/totp/verify", (req, res: Response) => {
    const { pendingToken, code } = req.body ?? {};
    if (!pendingToken || typeof pendingToken !== "string") {
      res.status(400).json({ error: "pendingToken is required" });
      return;
    }
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "code is required" });
      return;
    }

    const rlKey = verifyRateLimitKey(pendingToken);
    if (isVerifyBlocked(rlKey)) {
      res.status(429).json({ error: "Too many failed attempts — please restart the login flow" });
      return;
    }

    const payload = verifyPendingToken(pendingToken);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired pending token" });
      return;
    }

    const config = loadTotpConfig();
    if (!config?.enabled) {
      res.status(409).json({ error: "TOTP is not enabled" });
      return;
    }

    if (!verifyCodeWithBackupFallback(code)) {
      recordVerifyFailure(rlKey);
      res.status(401).json({ error: "Invalid authentication code" });
      return;
    }

    clearVerifyAttempts(rlKey);
    res.json({ token: signUserToken() });
  });

  /**
   * GET /api/auth/totp/status
   * Returns whether TOTP is currently enabled and remaining backup code count.
   */
  router.get("/api/auth/totp/status", requireNotAgentService, requireNotPendingToken, (_req, res: Response) => {
    const config = loadTotpConfig();
    res.json({
      enabled: config?.enabled ?? false,
      backupCodesRemaining: config?.backupCodes?.length ?? 0,
      enabledAt: config?.enabledAt ?? null,
    });
  });

  /**
   * GET /api/auth/totp/setup
   * Create a server-side setup session. Returns a setupToken (opaque handle),
   * the secret (for manual entry), QR code data URL, and plaintext backup codes.
   * Call POST /enable with { setupToken, code } to confirm. Setup sessions expire
   * after 10 minutes.
   * Requires a full user JWT.
   */
  router.get("/api/auth/totp/setup", requireNotAgentService, requireNotPendingToken, async (_req, res: Response) => {
    try {
      const { setupToken, secret, qrCodeDataUrl, backupCodes } = await prepareTotpSetup();
      res.json({ setupToken, secret, qrCodeDataUrl, backupCodes });
    } catch (err) {
      logger.error(`[totp] Setup generation failed: ${errorMessage(err)}`);
      res.status(500).json({ error: "Failed to generate TOTP setup data" });
    }
  });

  /**
   * POST /api/auth/totp/enable
   * Confirm TOTP setup by verifying the user's code against the server-held secret.
   * Body: { setupToken, code }
   * The setupToken was obtained from GET /setup. This replaces the old
   * { secret, code, backupCodes } flow so backup codes can never be tampered
   * with client-side.
   */
  router.post("/api/auth/totp/enable", requireNotAgentService, requireNotPendingToken, (req, res: Response) => {
    const { setupToken, code } = req.body ?? {};
    if (!setupToken || typeof setupToken !== "string") {
      res.status(400).json({ error: "setupToken is required" });
      return;
    }
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "code is required" });
      return;
    }

    const ok = confirmTotpSetup(setupToken, sanitizeCode(code));
    if (!ok) {
      res.status(401).json({ error: "Invalid or expired setup session, or incorrect TOTP code" });
      return;
    }

    logger.warn(`[AUDIT] TOTP enabled by user: ${(req as AuthenticatedRequest).user?.sub ?? "unknown"}`);
    res.json({ ok: true });
  });

  /**
   * DELETE /api/auth/totp/disable
   * Disable TOTP. Requires current TOTP code (or backup code) to confirm intent.
   * Body: { code }
   */
  router.delete("/api/auth/totp/disable", requireNotAgentService, requireNotPendingToken, (req, res: Response) => {
    const { code } = req.body ?? {};
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "code is required to confirm disable" });
      return;
    }

    if (!isTotpEnabled()) {
      res.status(409).json({ error: "TOTP is not enabled" });
      return;
    }

    if (!verifyCodeWithBackupFallback(code)) {
      res.status(401).json({ error: "Invalid authentication code" });
      return;
    }

    disableTotp();
    logger.warn(`[AUDIT] TOTP disabled by user: ${(req as AuthenticatedRequest).user?.sub ?? "unknown"}`);
    res.json({ ok: true });
  });

  /**
   * POST /api/auth/totp/backup-codes/regenerate
   * Generate new backup codes (invalidates old ones). Requires current TOTP code.
   * Body: { code }
   */
  router.post(
    "/api/auth/totp/backup-codes/regenerate",
    requireNotAgentService,
    requireNotPendingToken,
    (req, res: Response) => {
      const { code } = req.body ?? {};
      if (!code || typeof code !== "string") {
        res.status(400).json({ error: "code is required" });
        return;
      }

      if (!isTotpEnabled()) {
        res.status(409).json({ error: "TOTP is not enabled" });
        return;
      }

      const secret = loadDecryptedSecret();
      if (!secret || !verifyTotpCode(secret, sanitizeCode(code))) {
        res.status(401).json({ error: "Invalid TOTP code" });
        return;
      }

      const newCodes = regenerateBackupCodes();
      logger.warn(`[AUDIT] Backup codes regenerated by user: ${(req as AuthenticatedRequest).user?.sub ?? "unknown"}`);
      res.json({ backupCodes: newCodes });
    },
  );

  return router;
}
