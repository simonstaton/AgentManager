import fs from "node:fs";
import path from "node:path";

export interface MCPOAuthToken {
  server: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType: string;
  scope?: string;
  authenticatedAt: string;
}

/** Directory where MCP OAuth tokens are persisted */
const MCP_TOKEN_DIR = process.env.MCP_TOKEN_DIR || "/persistent/mcp-tokens";

/**
 * Ensures the MCP token directory exists
 */
export function ensureTokenDir(): void {
  if (!fs.existsSync(MCP_TOKEN_DIR)) {
    fs.mkdirSync(MCP_TOKEN_DIR, { recursive: true });
    console.log(`[MCP-OAuth] Created token directory: ${MCP_TOKEN_DIR}`);
  }
}

/**
 * Get the file path for a server's token storage
 */
function getTokenFilePath(server: string): string {
  return path.join(MCP_TOKEN_DIR, `${server}.json`);
}

/**
 * Save OAuth token for a specific MCP server
 */
export function saveToken(token: MCPOAuthToken): void {
  ensureTokenDir();
  const filePath = getTokenFilePath(token.server);
  fs.writeFileSync(filePath, JSON.stringify(token, null, 2), "utf8");
  console.log(`[MCP-OAuth] Saved token for ${token.server}`);
}

/**
 * Load OAuth token for a specific MCP server
 * Returns null if token doesn't exist
 */
export function loadToken(server: string): MCPOAuthToken | null {
  const filePath = getTokenFilePath(server);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(filePath, "utf8");
    const token = JSON.parse(data) as MCPOAuthToken;
    return token;
  } catch (err) {
    console.error(`[MCP-OAuth] Failed to load token for ${server}:`, err);
    return null;
  }
}

/**
 * Delete OAuth token for a specific MCP server
 */
export function deleteToken(server: string): void {
  const filePath = getTokenFilePath(server);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[MCP-OAuth] Deleted token for ${server}`);
  }
}

/**
 * Check if a token is expired
 */
export function isTokenExpired(token: MCPOAuthToken): boolean {
  if (!token.expiresAt) {
    return false; // No expiry means token doesn't expire
  }

  const expiresAt = new Date(token.expiresAt);
  const now = new Date();
  return now >= expiresAt;
}

/**
 * List all servers with stored tokens
 */
export function listStoredTokens(): string[] {
  ensureTokenDir();
  try {
    const files = fs.readdirSync(MCP_TOKEN_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch (err) {
    console.error("[MCP-OAuth] Failed to list stored tokens:", err);
    return [];
  }
}

/**
 * Get all stored tokens with their metadata
 */
export function getAllTokens(): MCPOAuthToken[] {
  const servers = listStoredTokens();
  return servers
    .map((server) => loadToken(server))
    .filter((token): token is MCPOAuthToken => token !== null);
}
