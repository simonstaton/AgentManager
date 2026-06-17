import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger";
import { registerSecretValue, unregisterSecretValue } from "./sanitize";
import { errorMessage } from "./types";

/**
 * Per-workflow credential storage for Linear API keys and GitHub PATs.
 *
 * Credentials are:
 * - Encrypted at rest with AES-256-GCM (key derived via PBKDF2 from ENCRYPTION_KEY or JWT_SECRET)
 * - Stored at /persistent/workflow-creds/{workflowId}.json with mode 0600
 * - Auto-expired after 4h TTL
 * - Registered with sanitize.ts for log redaction
 * - Deleted on workflow terminal state (completed/failed/cancelled)
 */

export interface WorkflowCredentials {
  workflowId: string;
  linearApiKey?: string;
  githubPat?: string;
  expiresAt: string;
  createdAt: string;
}

const CREDS_DIR = process.env.WORKFLOW_CREDS_DIR || "/persistent/workflow-creds";
const MAX_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const KEY_LEN = 32; // 256-bit key for AES-256-GCM
const IV_LEN = 12; // 96-bit IV (recommended for GCM)
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha256";
// Fixed subsystem salt — prevents cross-subsystem key reuse if the secret is shared
const KDF_SALT = "agentManager-workflow-credentials-v1";

// Lazy-derived key — computed once per process on first use
let _derivedKey: Buffer | null = null;

/**
 * Derive a 32-byte AES-256 encryption key via PBKDF2.
 * Uses ENCRYPTION_KEY env var (preferred) or JWT_SECRET as the input secret.
 */
function deriveKey(): Buffer {
  if (_derivedKey) return _derivedKey;
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("[workflow-credentials] No encryption key available. Set ENCRYPTION_KEY or JWT_SECRET.");
  }
  _derivedKey = crypto.pbkdf2Sync(secret, KDF_SALT, PBKDF2_ITERATIONS, KEY_LEN, PBKDF2_DIGEST);
  return _derivedKey;
}

/** Invalidate the cached derived key (e.g. after key rotation in tests). */
export function invalidateKeyCache(): void {
  _derivedKey = null;
}

/** Encrypt plaintext with AES-256-GCM. Returns "iv:authTag:ciphertext" (base64). */
function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

/** Decrypt ciphertext from "iv:authTag:ciphertext" format. Throws on tamper. */
function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivB64, authTagB64, dataB64] = parts;
  const key = deriveKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function ensureCredsDir(): void {
  if (!fs.existsSync(CREDS_DIR)) {
    fs.mkdirSync(CREDS_DIR, { recursive: true, mode: 0o700 });
  }
}

function getCredsFilePath(workflowId: string): string {
  // Sanitize to prevent path traversal
  const safe = workflowId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid workflowId");
  return path.join(CREDS_DIR, `${safe}.json`);
}

interface StoredCredFile {
  workflowId: string;
  encrypted: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * Store encrypted workflow credentials.
 * Registers secret values for log redaction.
 * Returns the stored credential record (with plaintext values for immediate use).
 */
export function storeWorkflowCredentials(
  workflowId: string,
  creds: { linearApiKey?: string; githubPat?: string },
): WorkflowCredentials {
  ensureCredsDir();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAX_TTL_MS).toISOString();
  const plaintext = JSON.stringify({
    linearApiKey: creds.linearApiKey,
    githubPat: creds.githubPat,
  });

  const encrypted = encrypt(plaintext);
  const stored: StoredCredFile = {
    workflowId,
    encrypted,
    expiresAt,
    createdAt: now.toISOString(),
  };

  const filePath = getCredsFilePath(workflowId);
  const nonce = crypto.randomBytes(4).toString("hex");
  const tmpPath = `${filePath}.tmp.${process.pid}.${nonce}`;
  fs.writeFileSync(tmpPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);

  // Register secrets for log redaction
  if (creds.linearApiKey) registerSecretValue(creds.linearApiKey);
  if (creds.githubPat) registerSecretValue(creds.githubPat);

  logger.info(`[workflow-credentials] Stored credentials for workflow ${workflowId.slice(0, 8)}`);
  return {
    workflowId,
    linearApiKey: creds.linearApiKey,
    githubPat: creds.githubPat,
    expiresAt,
    createdAt: now.toISOString(),
  };
}

/**
 * Load and decrypt workflow credentials.
 * Returns null if not found or expired.
 */
export function loadWorkflowCredentials(workflowId: string): WorkflowCredentials | null {
  let filePath: string;
  try {
    filePath = getCredsFilePath(workflowId);
  } catch {
    return null;
  }

  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const stored = JSON.parse(raw) as StoredCredFile;

    // Check TTL
    if (new Date() >= new Date(stored.expiresAt)) {
      logger.warn(`[workflow-credentials] Credentials expired for workflow ${workflowId.slice(0, 8)}`);
      deleteWorkflowCredentials(workflowId);
      return null;
    }

    const plaintext = decrypt(stored.encrypted);
    const creds = JSON.parse(plaintext) as {
      linearApiKey?: string;
      githubPat?: string;
    };

    // Re-register for redaction (e.g. after process restart with warm cache)
    if (creds.linearApiKey) registerSecretValue(creds.linearApiKey);
    if (creds.githubPat) registerSecretValue(creds.githubPat);

    return {
      workflowId,
      linearApiKey: creds.linearApiKey,
      githubPat: creds.githubPat,
      expiresAt: stored.expiresAt,
      createdAt: stored.createdAt,
    };
  } catch (err: unknown) {
    logger.error(
      `[workflow-credentials] Failed to load credentials for workflow ${workflowId.slice(0, 8)}: ${errorMessage(err)}`,
    );
    return null;
  }
}

/**
 * Securely delete workflow credentials.
 * Called on workflow terminal state (completed/failed/cancelled).
 */
export function deleteWorkflowCredentials(workflowId: string): void {
  let filePath: string;
  try {
    filePath = getCredsFilePath(workflowId);
  } catch {
    return;
  }

  if (!fs.existsSync(filePath)) return;

  try {
    // Best-effort: unregister from redaction before deletion
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const stored = JSON.parse(raw) as StoredCredFile;
      const plaintext = decrypt(stored.encrypted);
      const creds = JSON.parse(plaintext) as {
        linearApiKey?: string;
        githubPat?: string;
      };
      if (creds.linearApiKey) unregisterSecretValue(creds.linearApiKey);
      if (creds.githubPat) unregisterSecretValue(creds.githubPat);
    } catch {
      // Non-fatal — file may be corrupt or already unregistered
    }

    fs.unlinkSync(filePath);
    logger.info(`[workflow-credentials] Deleted credentials for workflow ${workflowId.slice(0, 8)}`);
  } catch (err: unknown) {
    logger.error(
      `[workflow-credentials] Failed to delete credentials for workflow ${workflowId.slice(0, 8)}: ${errorMessage(err)}`,
    );
  }
}

/**
 * Write a per-workflow MCP settings override into the agent workspace's .claude/ directory.
 * Overrides the platform's global LINEAR_API_KEY with the user-supplied key so the
 * Linear MCP server uses the workflow user's credentials, not the platform operator's.
 */
export function writeMcpOverride(workspaceDir: string, linearApiKey: string): void {
  const claudeDir = path.join(workspaceDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });

  // Read the global settings.json from the platform's CLAUDE_HOME
  const globalClaudeHome = process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
  const globalSettingsPath = path.join(globalClaudeHome, "settings.json");

  let baseSettings: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(globalSettingsPath, "utf8");
    baseSettings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Use empty settings if global not found — agent will use defaults
  }

  // Override the Linear MCP entry with workflow-scoped credentials
  const overrideSettings = {
    ...baseSettings,
    mcpServers: {
      ...(baseSettings.mcpServers as Record<string, unknown> | undefined),
      linear: {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: `Bearer ${linearApiKey}` },
      },
    },
  };

  const settingsPath = path.join(claudeDir, "settings.json");
  const nonce = crypto.randomBytes(4).toString("hex");
  const tmpPath = `${settingsPath}.tmp.${process.pid}.${nonce}`;
  fs.writeFileSync(tmpPath, JSON.stringify(overrideSettings, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(tmpPath, settingsPath);

  logger.info("[workflow-credentials] Wrote MCP override for workflow (Linear key set)");
}
