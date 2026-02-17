import path from "node:path";

const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(process.env.HOME || "/home/agent", ".claude");
const HOME = process.env.HOME || "/home/agent";

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
