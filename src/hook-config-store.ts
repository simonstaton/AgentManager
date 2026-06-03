import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger";

export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStart" | "SubagentStop";
export type HookType = "http" | "command";

export interface HookRule {
  id: string; // nanoid or crypto.randomUUID()
  event: HookEvent;
  type: HookType;
  matcher?: string; // regex string for tool name matching (PreToolUse/PostToolUse)
  url?: string; // required when type === 'http'
  command?: string; // required when type === 'command'
  timeout?: number; // ms, 1–60000, default 5000
  async?: boolean; // default false
}

export interface AgentHookConfig {
  agentId: string;
  rules: HookRule[];
  updatedAt: string; // ISO timestamp
}

const PERSISTENT_BASE = "/persistent";
const PERSISTENT_AVAILABLE = existsSync(PERSISTENT_BASE);
const HOOK_CONFIG_DIR = PERSISTENT_AVAILABLE ? `${PERSISTENT_BASE}/hook-configs` : "/tmp/hook-configs";

mkdirSync(HOOK_CONFIG_DIR, { recursive: true });

function configPath(agentId: string): string {
  return path.join(HOOK_CONFIG_DIR, `${agentId}.json`);
}

export function getHookConfig(agentId: string): AgentHookConfig {
  const filePath = configPath(agentId);
  if (!existsSync(filePath)) {
    return { agentId, rules: [], updatedAt: "" };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as AgentHookConfig;
  } catch (err: unknown) {
    logger.warn(
      `[hook-config-store] Failed to read config for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { agentId, rules: [], updatedAt: "" };
  }
}

export async function setHookConfig(agentId: string, rules: HookRule[]): Promise<AgentHookConfig> {
  const config: AgentHookConfig = {
    agentId,
    rules,
    updatedAt: new Date().toISOString(),
  };
  const filePath = configPath(agentId);
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(config), "utf-8");
  await rename(tmpPath, filePath);
  return config;
}

export function deleteHookConfig(agentId: string): void {
  const filePath = configPath(agentId);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export function buildSettingsJson(agentId: string): object {
  // This function is the future integration point for agents.ts generateHooksSettings().
  // When agents.ts Ph2 lock is released, replace the hardcoded settings with:
  //   const config = getHookConfig(agentId);
  //   ... build hooks object from config.rules ...
  const config = getHookConfig(agentId);
  const hooksByEvent: Record<string, unknown[]> = {};
  for (const rule of config.rules) {
    if (!hooksByEvent[rule.event]) hooksByEvent[rule.event] = [];
    const handler: Record<string, unknown> = {
      type: rule.type,
      timeout: rule.timeout ?? 5000,
      async: rule.async ?? false,
    };
    if (rule.type === "http") handler.url = rule.url;
    else handler.command = rule.command;
    const entry: Record<string, unknown> = { hooks: [handler] };
    if (rule.matcher) entry.matcher = rule.matcher;
    hooksByEvent[rule.event].push(entry);
  }
  return Object.keys(hooksByEvent).length > 0 ? { hooks: hooksByEvent } : {};
}
