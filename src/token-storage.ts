import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { registerSecretValue, unregisterSecretValue } from "./sanitize";
import mapping from "./service-mapping.json";
import { errorMessage } from "./types";

/**
 * Unified token storage for all integrations (GitHub, Linear, Figma, etc.).
 * Backward compatible with the existing MCPOAuthToken shape.
 *
 * Stores one JSON file per service in /persistent/mcp-tokens/.
 * Uses atomic write (tmp + rename) to prevent corruption.
 */

export interface StoredToken {
  server: string;
  /** UI-set token value */
  token?: string;
  label?: string;
  source: "ui" | "oauth" | "env";
  setAt?: string;
  validatedUser?: string;
  /** OAuth fields (backward compat with MCPOAuthToken) */
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scope?: string;
  authenticatedAt?: string;
}

/** Backward-compatible alias for existing OAuth consumers */
export type MCPOAuthToken = StoredToken;

/** Canonical env-var-to-service mapping. Source of truth: src/service-mapping.json */
export const ENV_TO_SERVICE: Record<string, string> = mapping.envToService;

/** Canonical service-to-env mapping (primary env var per service). */
export const SERVICE_TO_ENV: Record<string, string> = mapping.serviceToEnv;

/** All known service names. */
export const KNOWN_SERVICES = new Set(Object.keys(SERVICE_TO_ENV));

const TOKEN_DIR = process.env.MCP_TOKEN_DIR || "/persistent/mcp-tokens";

/** In-memory cache: service name → StoredToken | null (null = checked, not found) */
let tokenCache = new Map<string, StoredToken | null>();

export function ensureTokenDir(): void {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
}

function getTokenFilePath(server: string): string {
  const safe = server.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(TOKEN_DIR, `${safe}.json`);
}

/** Atomic write: write to tmp file then rename to prevent corruption. */
function atomicWriteSync(filePath: string, data: string): void {
  const nonce = crypto.randomBytes(4).toString("hex");
  const tmpPath = `${filePath}.tmp.${process.pid}.${nonce}`;
  fs.writeFileSync(tmpPath, data, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

/** Save a token (UI-set or OAuth). Registers the secret for redaction. */
export function saveToken(token: StoredToken): void {
  ensureTokenDir();

  // Unregister the previous secret before overwriting (prevents unbounded growth of dynamicSecrets)
  const existing = tokenCache.get(token.server);
  if (existing) {
    const oldSecret = existing.token || existing.accessToken;
    if (oldSecret) unregisterSecretValue(oldSecret);
  }

  const filePath = getTokenFilePath(token.server);
  atomicWriteSync(filePath, JSON.stringify(token, null, 2));
  tokenCache.set(token.server, token);

  const secretVal = token.token || token.accessToken;
  if (secretVal) registerSecretValue(secretVal);

  logger.info(`[token-storage] Saved token for ${token.server} (source: ${token.source})`);
}

/** Save a UI-set token for a service. */
export function saveUIToken(
  server: string,
  tokenValue: string,
  opts?: { label?: string; validatedUser?: string },
): void {
  saveToken({
    server,
    token: tokenValue,
    source: "ui",
    label: opts?.label,
    validatedUser: opts?.validatedUser,
    setAt: new Date().toISOString(),
  });
}

/** Load a stored token for a service. Returns null if not found. */
export function loadToken(server: string): StoredToken | null {
  const cached = tokenCache.get(server);
  if (cached !== undefined) return cached;

  const filePath = getTokenFilePath(server);
  if (!fs.existsSync(filePath)) {
    tokenCache.set(server, null);
    return null;
  }

  try {
    const data = fs.readFileSync(filePath, "utf8");
    const token = JSON.parse(data) as StoredToken;
    tokenCache.set(server, token);

    const secretVal = token.token || token.accessToken;
    if (secretVal) registerSecretValue(secretVal);

    return token;
  } catch (err: unknown) {
    logger.error(`[token-storage] Failed to load token for ${server}: ${errorMessage(err)}`);
    tokenCache.set(server, null);
    return null;
  }
}

/** Delete a stored token. Unregisters the secret from redaction. */
export function deleteToken(server: string): void {
  const existing = loadToken(server);
  if (existing) {
    const secretVal = existing.token || existing.accessToken;
    if (secretVal) unregisterSecretValue(secretVal);
  }

  const filePath = getTokenFilePath(server);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info(`[token-storage] Deleted token for ${server}`);
  }
  tokenCache.set(server, null);
}

export function isTokenExpired(token: StoredToken): boolean {
  if (!token.expiresAt) return false;
  return new Date() >= new Date(token.expiresAt);
}

/** List all services that have stored token files. */
export function listStoredTokens(): string[] {
  ensureTokenDir();
  try {
    return fs
      .readdirSync(TOKEN_DIR)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp.json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch (err: unknown) {
    logger.error(`[token-storage] Failed to list stored tokens: ${errorMessage(err)}`);
    return [];
  }
}

/** Get all stored tokens with their metadata. */
export function getAllTokens(): StoredToken[] {
  return listStoredTokens()
    .map((server) => loadToken(server))
    .filter((token): token is StoredToken => token !== null);
}

/**
 * Get the effective token value for a service.
 * Priority: stored token (UI/OAuth) → env var fallback.
 */
export function getEffectiveTokenValue(server: string): string | null {
  const stored = loadToken(server);
  if (stored) {
    if (stored.token) return stored.token;
    if (stored.accessToken && !isTokenExpired(stored)) return stored.accessToken;
  }
  const envKey = SERVICE_TO_ENV[server];
  return envKey ? process.env[envKey] || null : null;
}

/**
 * Get the status of all known integrations (for the API response).
 * Never returns raw token values — only metadata.
 */
export function getTokenStatuses(): Record<
  string,
  { configured: boolean; source: string; hint: string | null; label?: string; user?: string }
> {
  const result: Record<
    string,
    { configured: boolean; source: string; hint: string | null; label?: string; user?: string }
  > = {};

  for (const [service, envKey] of Object.entries(SERVICE_TO_ENV)) {
    const stored = loadToken(service);
    const envVal = process.env[envKey];
    const effectiveValue = stored?.token || stored?.accessToken || envVal;

    let source = "none";
    if (stored?.source === "ui" && stored.token) source = "ui";
    else if (stored?.source === "oauth" && stored.accessToken && !isTokenExpired(stored)) source = "oauth";
    else if (stored?.source === "env" && stored.token) source = "env";
    else if (envVal) source = "env";

    result[service] = {
      configured: !!effectiveValue,
      source,
      hint: effectiveValue ? `...${effectiveValue.slice(-4)}` : null,
      label: stored?.label,
      user: stored?.validatedUser,
    };
  }

  return result;
}

/** Invalidate the in-memory cache (e.g. after syncing from GCS). */
export function invalidateTokenCache(): void {
  tokenCache = new Map();
}

/** Preload all tokens into cache and register secrets for redaction. Called at startup. */
export function preloadTokens(): void {
  invalidateTokenCache();
  const services = listStoredTokens();
  for (const server of services) {
    loadToken(server);
  }
  logger.info(`[token-storage] Preloaded ${services.length} token(s)`);
}
