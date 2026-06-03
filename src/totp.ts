/**
 * TOTP (Time-based One-Time Password) support
 *
 * Provides:
 * - TOTP secret generation and QR code rendering
 * - AES-256-GCM encryption of the secret at rest (keyed from JWT_SECRET)
 * - Backup code generation (plaintext for display, SHA-256 hashed for storage)
 * - Config load/save to /persistent/totp.json
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { generateSecret, generateURI, NobleCryptoPlugin, ScureBase32Plugin, verifySync } from "otplib";
import QRCode from "qrcode";
import { logger } from "./logger";
import { registerSecretValue, unregisterSecretValue } from "./sanitize";
import { errorMessage } from "./types";

// ── Storage ──────────────────────────────────────────────────────────────────

const TOTP_FILE = process.env.TOTP_CONFIG_FILE || "/persistent/totp.json";

export interface TotpConfig {
  enabled: boolean;
  /** AES-256-GCM ciphertext, hex-encoded */
  encryptedSecret: string;
  /** GCM IV, hex-encoded (12 bytes — NIST SP 800-38D recommended size) */
  iv: string;
  /** GCM auth tag, hex-encoded (16 bytes) */
  authTag: string;
  /** SHA-256 hashed backup codes (hex). Consumed codes are removed. */
  backupCodes: string[];
  enabledAt: string;
}

export function loadTotpConfig(): TotpConfig | null {
  try {
    if (!fs.existsSync(TOTP_FILE)) return null;
    const raw = fs.readFileSync(TOTP_FILE, "utf-8");
    return JSON.parse(raw) as TotpConfig;
  } catch (err) {
    logger.warn(`[totp] Failed to read config: ${errorMessage(err)}`);
    return null;
  }
}

export function saveTotpConfig(config: TotpConfig): void {
  const dir = path.dirname(TOTP_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${TOTP_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, TOTP_FILE);
}

export function clearTotpConfig(): void {
  try {
    if (fs.existsSync(TOTP_FILE)) fs.unlinkSync(TOTP_FILE);
  } catch (err) {
    logger.warn(`[totp] Failed to clear config: ${errorMessage(err)}`);
  }
}

export function isTotpEnabled(): boolean {
  const config = loadTotpConfig();
  return config?.enabled === true;
}

// ── Encryption ───────────────────────────────────────────────────────────────

/** Derive a 32-byte AES key from the JWT_SECRET using scrypt. */
function deriveKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return crypto.scryptSync(secret, "agent-manager-totp-v1", 32);
}

interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function encryptSecret(plaintext: string): EncryptedData {
  const key = deriveKey();
  // 12-byte (96-bit) IV is the NIST-recommended size for AES-GCM
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

function decryptSecret(data: EncryptedData): string {
  const key = deriveKey();
  const iv = Buffer.from(data.iv, "hex");
  const authTag = Buffer.from(data.authTag, "hex");
  const ciphertext = Buffer.from(data.ciphertext, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Read the raw TOTP secret from persisted config (decrypted). */
export function loadDecryptedSecret(): string | null {
  const config = loadTotpConfig();
  if (!config?.enabled) return null;
  try {
    return decryptSecret({
      ciphertext: config.encryptedSecret,
      iv: config.iv,
      authTag: config.authTag,
    });
  } catch (err) {
    logger.error(`[totp] Failed to decrypt secret: ${errorMessage(err)}`);
    return null;
  }
}

// ── TOTP Generation & Verification ───────────────────────────────────────────

const otpPlugins = {
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
};

/** Generate a new base32 TOTP secret. */
export function generateTotpSecret(): string {
  return generateSecret({ ...otpPlugins, length: 20 });
}

/** Verify a 6-digit TOTP code against a raw base32 secret. */
export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    // Allow ±1 time step (30s window) for clock skew tolerance
    const result = verifySync({ token: code, secret, ...otpPlugins, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

/** Generate the otpauth:// URI for use in QR codes. */
export function generateOtpauthUrl(secret: string, label = "AgentManager"): string {
  return generateURI({ secret, issuer: "AgentManager", label });
}

/** Render the otpauth URI as a PNG data URL for embedding in an <img> tag. */
export async function generateQrCodeDataUrl(secret: string, label = "AgentManager"): Promise<string> {
  const otpauthUrl = generateOtpauthUrl(secret, label);
  return QRCode.toDataURL(otpauthUrl, {
    width: 200,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

// ── Backup Codes ─────────────────────────────────────────────────────────────

const BACKUP_CODE_COUNT = 10;

function formatBackupCode(raw: Buffer): string {
  // 8 bytes = 16 hex chars, split into 4 groups of 4 for readability
  const hex = raw.toString("hex").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

function hashBackupCode(code: string): string {
  // Normalise: remove dashes, uppercase
  const normalised = code.replace(/-/g, "").toUpperCase();
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

export interface GeneratedBackupCodes {
  /** Plaintext codes to display to the user (one-time) */
  plain: string[];
  /** SHA-256 hashed codes for storage */
  hashed: string[];
}

export function generateBackupCodes(): GeneratedBackupCodes {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // 8 bytes = 64 bits of entropy per code
    const raw = crypto.randomBytes(8);
    const code = formatBackupCode(raw);
    plain.push(code);
    hashed.push(hashBackupCode(code));
  }
  return { plain, hashed };
}

/**
 * Verify a backup code against the stored hashes.
 * If valid, removes the used code from the list (returns the updated list).
 * Returns null if the code is invalid.
 */
export function verifyAndConsumeBackupCode(code: string, storedHashes: string[]): { remaining: string[] } | null {
  const hash = hashBackupCode(code);
  const idx = storedHashes.indexOf(hash);
  if (idx === -1) return null;
  const remaining = [...storedHashes.slice(0, idx), ...storedHashes.slice(idx + 1)];
  return { remaining };
}

// ── Setup Sessions ────────────────────────────────────────────────────────────
// Store setup state server-side so the client never needs to send the TOTP
// secret or backup code hashes back to the server. This prevents a client-side
// attacker (e.g. XSS) from registering their own backup codes.

interface SetupSession {
  secret: string;
  hashedBackupCodes: string[];
  expiresAt: number; // ms since epoch
}

const SETUP_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const setupSessions = new Map<string, SetupSession>();

function pruneExpiredSetupSessions(): void {
  const now = Date.now();
  for (const [id, session] of setupSessions) {
    if (session.expiresAt < now) setupSessions.delete(id);
  }
}

// ── High-level enable/disable ─────────────────────────────────────────────────

export interface TotpSetupData {
  /** Opaque token identifying the server-side setup session. */
  setupToken: string;
  /** Plaintext secret for manual entry into an authenticator app. */
  secret: string;
  qrCodeDataUrl: string;
  /** Plaintext backup codes for the user to save (displayed once). */
  backupCodes: string[];
}

/**
 * Create a server-side setup session.
 * Returns a setupToken (opaque handle) plus the QR code and plaintext backup
 * codes for display. The secret and hashed codes are held server-side and
 * never travel back from the client.
 */
export async function prepareTotpSetup(): Promise<TotpSetupData> {
  pruneExpiredSetupSessions();
  const secret = generateTotpSecret();
  const qrCodeDataUrl = await generateQrCodeDataUrl(secret);
  const { plain: backupCodes, hashed: hashedBackupCodes } = generateBackupCodes();
  // Register secret value to be redacted in logs
  registerSecretValue(secret);

  const setupToken = crypto.randomBytes(32).toString("hex");
  setupSessions.set(setupToken, {
    secret,
    hashedBackupCodes,
    expiresAt: Date.now() + SETUP_SESSION_TTL_MS,
  });

  return { setupToken, secret, qrCodeDataUrl, backupCodes };
}

/**
 * Persist TOTP config after the user has confirmed their code.
 * Looks up the server-side setup session by setupToken, verifies the code,
 * then encrypts the secret and stores the pre-computed hashed backup codes.
 * Returns false if the setupToken is unknown/expired or the code is invalid.
 */
export function confirmTotpSetup(setupToken: string, code: string): boolean {
  pruneExpiredSetupSessions();
  const session = setupSessions.get(setupToken);
  if (!session || session.expiresAt < Date.now()) {
    setupSessions.delete(setupToken);
    return false;
  }

  if (!verifyTotpCode(session.secret, code)) {
    return false;
  }

  setupSessions.delete(setupToken);

  const { ciphertext, iv, authTag } = encryptSecret(session.secret);
  const config: TotpConfig = {
    enabled: true,
    encryptedSecret: ciphertext,
    iv,
    authTag,
    backupCodes: session.hashedBackupCodes,
    enabledAt: new Date().toISOString(),
  };
  saveTotpConfig(config);
  registerSecretValue(session.secret);
  logger.info("[AUDIT] TOTP enabled");
  return true;
}

/** Disable TOTP and remove all stored config. */
export function disableTotp(): void {
  const secret = loadDecryptedSecret();
  if (secret) unregisterSecretValue(secret);
  clearTotpConfig();
  logger.info("[AUDIT] TOTP disabled");
}

/**
 * Regenerate backup codes. Persists the new hashed codes to config.
 * Returns the new plaintext codes for display.
 */
export function regenerateBackupCodes(): string[] {
  const config = loadTotpConfig();
  if (!config?.enabled) throw new Error("TOTP is not enabled");
  const { plain, hashed } = generateBackupCodes();
  saveTotpConfig({ ...config, backupCodes: hashed });
  return plain;
}
