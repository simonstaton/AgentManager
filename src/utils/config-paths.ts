import path from "node:path";

const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(process.env.HOME || "/home/agent", ".claude");
const HOME = process.env.HOME || "/home/agent";

/**
 * Check whether a file path is allowed for read/write operations by the
 * Claude config API.
 *
 * A path is allowed when it resolves to one of:
 * - Any file inside `CLAUDE_HOME` (`~/.claude/` by default)
 * - `~/.claude.json` (identity config)
 * - `~/CLAUDE.md` (home-level agent instructions)
 * - `<cwd>/CLAUDE.md` (project-level agent instructions)
 * - `<cwd>/mcp/settings-template.json` (MCP server definitions)
 *
 * Paths containing `..` segments are rejected before resolution to prevent
 * path-traversal attacks.
 *
 * @param filePath - The raw file path to validate (may be relative or absolute).
 * @returns `true` if the path is within an allowed location, `false` otherwise.
 */
export function isAllowedConfigPath(filePath: string): boolean {
  // Reject paths containing ".." segments before resolution
  if (filePath.includes("..")) {
    return false;
  }

  const resolved = path.resolve(filePath);
  return (
    resolved.startsWith(path.resolve(CLAUDE_HOME)) ||
    resolved === path.resolve(path.join(HOME, ".claude.json")) ||
    resolved === path.resolve(path.join(HOME, "CLAUDE.md")) ||
    resolved === path.resolve(path.join(process.cwd(), "CLAUDE.md")) ||
    resolved === path.resolve(path.join(process.cwd(), "mcp", "settings-template.json"))
  );
}

export { CLAUDE_HOME, HOME };
