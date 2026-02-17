import { readdirSync } from "node:fs";
import path from "node:path";

const IGNORED = new Set(["node_modules", ".git", ".cache", "__pycache__", "dist", ".next"]);

/** Walk a directory recursively, returning all file paths (absolute). */
export function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
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

/** Walk a directory recursively, returning relative paths of .md files. */
export function walkMdFiles(dir: string): string[] {
  return walkDir(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.relative(dir, f));
}

/** Walk a directory recursively, returning relative paths of .md files in a specific subdirectory. */
export function scanCommands(dir: string): string[] {
  return walkDir(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => `/${path.relative(dir, f).replace(/\.md$/, "")}`);
}

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
