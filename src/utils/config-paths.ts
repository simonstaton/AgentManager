import fs from "node:fs";
import path from "node:path";

const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(process.env.HOME || "/home/agent", ".claude");
const HOME = process.env.HOME || "/home/agent";

/**
 * Resolve a path to its real location, following symlinks if the file exists.
 * Falls back to path.resolve() for paths that don't exist yet (e.g. new files
 * being written for the first time).
 */
function safeRealpath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    // File doesn't exist yet - resolve without symlink expansion
    return path.resolve(filePath);
  }
}

// Cached resolved static allowlist paths (computed once per process to avoid repeated realpathSync).
let cachedClaudeHomePrefix: string | null = null;
let cachedAllowedExact: Set<string> | null = null;

function getAllowedStaticPaths(): { claudeHomePrefix: string; allowedExact: Set<string> } {
  if (cachedClaudeHomePrefix !== null && cachedAllowedExact !== null) {
    return { claudeHomePrefix: cachedClaudeHomePrefix, allowedExact: cachedAllowedExact };
  }
  const cwd = process.cwd();
  cachedClaudeHomePrefix = safeRealpath(CLAUDE_HOME);
  cachedAllowedExact = new Set([
    safeRealpath(path.join(HOME, ".claude.json")),
    safeRealpath(path.join(HOME, "CLAUDE.md")),
    safeRealpath(path.join(cwd, "CLAUDE.md")),
    safeRealpath(path.join(cwd, "mcp", "settings-template.json")),
  ]);
  return { claudeHomePrefix: cachedClaudeHomePrefix, allowedExact: cachedAllowedExact };
}

export function isAllowedConfigPath(filePath: string): boolean {
  if (filePath.includes("..")) return false;
  const resolved = safeRealpath(filePath);
  const { claudeHomePrefix, allowedExact } = getAllowedStaticPaths();
  return resolved.startsWith(claudeHomePrefix) || allowedExact.has(resolved);
}

/**
 * Reject symlinks on write operations - callers should use this before writing
 * to any config path to prevent symlink-based write attacks.
 */
export function isSymlink(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

export { CLAUDE_HOME, HOME };
