/** Format a git remote URL for compact display (strips protocol/host, removes .git suffix). */
export function formatRepo(url: string): string {
  return url
    .replace(/\.git$/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^git@[^:]+:/, "");
}
