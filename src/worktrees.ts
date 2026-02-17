import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { errorMessage } from "./types";

const PERSISTENT_REPOS = "/persistent/repos";

/**
 * Clean up git worktrees owned by a specific agent workspace.
 * Worktrees created by agents live under /tmp/workspace-{uuid}/ and reference
 * bare repos in /persistent/repos/*.git. When an agent is destroyed we need to
 * both `git worktree remove` them (so the bare repo's worktree list stays clean)
 * and delete the on-disk directory.
 */
export function cleanupWorktreesForWorkspace(workspaceDir: string): void {
  if (!existsSync(PERSISTENT_REPOS)) return;

  let bareRepos: string[];
  try {
    bareRepos = readdirSync(PERSISTENT_REPOS).filter((f) => f.endsWith(".git"));
  } catch {
    return;
  }

  for (const repo of bareRepos) {
    const repoPath = path.join(PERSISTENT_REPOS, repo);
    try {
      // Prune stale worktree entries first — removes references to directories
      // that no longer exist, preventing "already checked out" errors for
      // future agents that try to use the same branch.
      execFileSync("git", ["-C", repoPath, "worktree", "prune"], { timeout: 10_000 });

      const output = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
        encoding: "utf-8",
        timeout: 10_000,
      });

      for (const block of output.split("\n\n")) {
        const wtLine = block.split("\n").find((l) => l.startsWith("worktree "));
        if (!wtLine) continue;
        const wtPath = wtLine.replace("worktree ", "");
        // Only remove worktrees that live inside this agent's workspace
        if (wtPath.startsWith(workspaceDir)) {
          try {
            execFileSync("git", ["-C", repoPath, "worktree", "remove", "--force", wtPath], {
              timeout: 10_000,
            });
          } catch {
            // If git worktree remove fails, prune will catch it later
          }
        }
      }

      // Final prune to clean up any entries left after force-remove
      execFileSync("git", ["-C", repoPath, "worktree", "prune"], { timeout: 10_000 });
    } catch {
      // repo may not be a valid git repo — skip
    }
  }
}

/**
 * Prune all stale worktrees across every bare repo in /persistent/repos/.
 * A worktree is stale when its working directory no longer exists on disk —
 * which happens when an agent's /tmp/workspace-{uuid} is cleaned up (either by
 * destroy, container restart, or OS tmpdir cleanup).
 *
 * Also detects and removes worktrees pointing at workspace dirs that have no
 * corresponding running agent (orphaned worktrees from crashed/killed agents).
 */
export function pruneAllWorktrees(activeWorkspaceDirs?: Set<string>): { pruned: number; errors: string[] } {
  const result = { pruned: 0, errors: [] as string[] };
  if (!existsSync(PERSISTENT_REPOS)) return result;

  let bareRepos: string[];
  try {
    bareRepos = readdirSync(PERSISTENT_REPOS).filter((f) => f.endsWith(".git"));
  } catch {
    return result;
  }

  for (const repo of bareRepos) {
    const repoPath = path.join(PERSISTENT_REPOS, repo);
    try {
      // First: git worktree prune removes entries whose directories are gone
      execFileSync("git", ["-C", repoPath, "worktree", "prune"], { timeout: 10_000 });

      // Second: if we have a list of active workspaces, remove worktrees for dead agents
      if (activeWorkspaceDirs) {
        const output = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
          encoding: "utf-8",
          timeout: 10_000,
        });

        for (const block of output.split("\n\n")) {
          const wtLine = block.split("\n").find((l) => l.startsWith("worktree "));
          if (!wtLine) continue;
          const wtPath = wtLine.replace("worktree ", "");

          // Skip the bare repo's own main worktree
          if (wtPath === repoPath) continue;

          // Check if this worktree is inside a /tmp/workspace-* dir
          const wsMatch = wtPath.match(/^(\/tmp\/workspace-[a-f0-9-]+)/);
          if (wsMatch && !activeWorkspaceDirs.has(wsMatch[1])) {
            try {
              execFileSync("git", ["-C", repoPath, "worktree", "remove", "--force", wtPath], {
                timeout: 10_000,
              });
              result.pruned++;
              console.log(`[worktree] Pruned orphaned worktree: ${wtPath} (repo: ${repo})`);
            } catch (err: unknown) {
              result.errors.push(`Failed to remove ${wtPath}: ${errorMessage(err)}`);
            }
          }
        }
      }

      // Final prune pass to clean up any lock files or metadata
      execFileSync("git", ["-C", repoPath, "worktree", "prune"], { timeout: 10_000 });
    } catch (err: unknown) {
      result.errors.push(`${repo}: ${errorMessage(err)}`);
    }
  }

  return result;
}

/**
 * Run a full worktree garbage collection. Intended to be called:
 * 1. On server startup (entrypoint.sh or server.ts init)
 * 2. Periodically (every 10 minutes) while the server is running
 * 3. On agent destroy (targeted cleanup)
 */
export function startWorktreeGC(getActiveWorkspaceDirs: () => Set<string>): ReturnType<typeof setInterval> {
  // Run immediately on start
  const dirs = getActiveWorkspaceDirs();
  const initial = pruneAllWorktrees(dirs);
  if (initial.pruned > 0) {
    console.log(`[worktree] Startup GC: pruned ${initial.pruned} stale worktrees`);
  }

  // Then every 10 minutes
  return setInterval(
    () => {
      try {
        const activeDirs = getActiveWorkspaceDirs();
        const result = pruneAllWorktrees(activeDirs);
        if (result.pruned > 0) {
          console.log(`[worktree] Periodic GC: pruned ${result.pruned} stale worktrees`);
        }
      } catch (err) {
        console.error("[worktree] GC error:", err);
      }
    },
    10 * 60 * 1000,
  );
}
