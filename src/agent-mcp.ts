/**
 * Per-agent MCP server scoping.
 *
 * MCP server tool definitions are injected into every turn's input tokens. The
 * platform activates all credentialed servers globally (mcp-bootstrap), so an
 * agent that never touches Figma still pays for Figma's tool schema on every
 * message. This lets a spawn declare an allowlist (`mcpServers`) of the servers
 * it actually needs; the CLI is then run with `--mcp-config <file>
 * --strict-mcp-config` so only those load.
 *
 * Opt-in: with no allowlist, nothing here runs and the agent keeps the global
 * server set (unchanged behaviour).
 */

import fs from "node:fs";
import path from "node:path";
import { CLAUDE_HOME } from "./utils/config-paths";

/** Filename for the per-agent MCP config, written into the workspace .claude dir. */
export const AGENT_MCP_FILENAME = "agent-mcp.json";

type McpServerMap = Record<string, unknown>;

/**
 * Filter a global mcpServers map down to an allowlist of server names.
 * Returns the kept subset plus the names that were requested but not found
 * (typos / unconfigured servers) and the names dropped from the global set.
 */
export function filterMcpServers(
  global: McpServerMap,
  allow: string[],
): { servers: McpServerMap; missing: string[]; dropped: string[] } {
  const allowSet = new Set(allow);
  const servers: McpServerMap = {};
  for (const name of allow) {
    if (Object.hasOwn(global, name)) servers[name] = global[name];
  }
  const missing = allow.filter((n) => !Object.hasOwn(global, n));
  const dropped = Object.keys(global).filter((n) => !allowSet.has(n));
  return { servers, missing, dropped };
}

/** Read the global activated mcpServers map from the resolved settings.json. */
export function readGlobalMcpServers(settingsPath: string = path.join(CLAUDE_HOME, "settings.json")): McpServerMap {
  try {
    if (!fs.existsSync(settingsPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { mcpServers?: McpServerMap };
    return parsed.mcpServers ?? {};
  } catch {
    return {};
  }
}

/** The deterministic path of an agent's scoped MCP config within its workspace. */
export function agentMcpConfigPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".claude", AGENT_MCP_FILENAME);
}

/**
 * Build and write a workspace-scoped MCP config containing only the allowlisted
 * servers. Returns the file path to pass to `--mcp-config`, or null if the
 * allowlist is empty/undefined (caller should not add the strict flags).
 */
export function prepareAgentMcpConfig(
  workspaceDir: string,
  allow: string[] | undefined,
  global: McpServerMap = readGlobalMcpServers(),
): { configPath: string; servers: McpServerMap; missing: string[]; dropped: string[] } | null {
  if (!allow || allow.length === 0) return null;
  const { servers, missing, dropped } = filterMcpServers(global, allow);
  const configPath = agentMcpConfigPath(workspaceDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: servers }, null, 2));
  return { configPath, servers, missing, dropped };
}
