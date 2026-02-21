import { readdirSync } from "node:fs";
import path from "node:path";

const IGNORED = new Set(["node_modules", ".git", ".cache", "__pycache__", "dist", ".next"]);

/**
 * Walk a directory recursively, returning all file paths (absolute).
 *
 * Directories in the {@link IGNORED} set are skipped entirely. Errors reading
 * any individual directory are silently caught so a single unreadable entry
 * does not abort the whole walk.
 *
 * @param dir - Absolute path of the directory to walk.
 * @returns Array of absolute file paths found under `dir`.
 */
export function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

/**
 * Walk a directory recursively, returning relative paths of `.md` files.
 *
 * Paths are relative to `dir` so they are safe to use as logical file names
 * without leaking the host filesystem prefix.
 *
 * @param dir - Absolute path of the directory to walk.
 * @returns Array of `.md` file paths relative to `dir`.
 */
export function walkMdFiles(dir: string): string[] {
  return walkDir(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.relative(dir, f));
}

/**
 * Walk a directory recursively and return slash-command names derived from
 * `.md` filenames found inside it.
 *
 * Each result is prefixed with `/` and has the `.md` extension stripped, so
 * `commands/foo/bar.md` becomes `/foo/bar`.
 *
 * @param dir - Absolute path of the commands directory to scan.
 * @returns Array of slash-command names (e.g. `["/check-messages", "/send-message"]`).
 */
export function scanCommands(dir: string): string[] {
  return walkDir(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => `/${path.relative(dir, f).replace(/\.md$/, "")}`);
}

/**
 * Recursively list files under `dir` that match an optional query string,
 * returning paths relative to `baseDir`.
 *
 * The walk is bounded by `maxResults` and a maximum directory depth of 6.
 * Hidden entries (names starting with `.`) at depth 0 are skipped.
 * Directories in the {@link IGNORED} set are always skipped.
 *
 * @param dir - Current directory being scanned (changes with each recursive call).
 * @param baseDir - Root directory used to compute relative paths in the output.
 * @param query - Lowercase substring to match against relative file paths.
 *   Pass an empty string to return all files.
 * @param maxResults - Maximum number of results to collect before stopping.
 * @param results - Accumulator array shared across recursive calls; defaults to `[]`.
 * @param depth - Current recursion depth; defaults to `0`.
 * @returns Array of file paths relative to `baseDir`, up to `maxResults` entries.
 */
export function listFilesRecursive(
  dir: string,
  baseDir: string,
  query: string,
  maxResults: number,
  results: string[] = [],
  depth = 0,
): string[] {
  if (depth > 6 || results.length >= maxResults) return results;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (entry.name.startsWith(".") && depth === 0) continue;
      if (IGNORED.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        listFilesRecursive(fullPath, baseDir, query, maxResults, results, depth + 1);
      } else {
        if (!query || relativePath.toLowerCase().includes(query)) {
          results.push(relativePath);
        }
      }
    }
  } catch {}

  return results;
}
