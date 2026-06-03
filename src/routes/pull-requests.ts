/**
 * Pull Requests route — lists open PRs across all repos.
 *
 * Uses `gh pr list` to query GitHub for open PRs across all repos in
 * /persistent/repos. Cross-references with active agents to show which
 * agent created/is working on each PR. Results are cached for 30 seconds
 * to avoid hammering the GitHub API.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import express, { type Request, type Response } from "express";
import type { AgentManager } from "../agents";
import { logger } from "../logger";
import { getRepoPat } from "../secrets-store";

const execFileAsync = promisify(execFile);
const PERSISTENT_REPOS = "/persistent/repos";

/**
 * Wire-format for a PR item returned by this endpoint.
 * Matches the PullRequestItem interface defined in ui/src/api.ts.
 */
interface PullRequestItem {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged" | "draft";
  branch: string;
  baseBranch: string;
  author: string;
  repo: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  checksStatus: "pending" | "passing" | "failing" | "none";
  reviewDecision: string;
  createdAt: string;
  updatedAt: string;
  agent: { id: string; name: string } | null;
  labels: string[];
}

interface PRCache {
  prs: PullRequestItem[];
  fetchedAt: number;
}
let cache: PRCache | null = null;
const CACHE_TTL_MS = 30_000;

/**
 * GitHub CLI JSON shape for a single PR in `gh pr list` output.
 */
interface GhPR {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  state: string;
  author: { login: string; name?: string | null };
  createdAt: string;
  updatedAt: string;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  statusCheckRollup: Array<{
    status?: string;
    conclusion?: string;
    state?: string;
  }> | null;
  labels: Array<{ name: string }> | null;
}

/**
 * Derive CI checks status from statusCheckRollup array.
 */
export function deriveChecksStatus(rollup: GhPR["statusCheckRollup"]): "pending" | "passing" | "failing" | "none" {
  if (!rollup || rollup.length === 0) return "none";

  const statuses = rollup.map((r) => (r.conclusion ?? r.state ?? r.status ?? "").toUpperCase());

  if (statuses.some((s) => s === "FAILURE" || s === "FAILED" || s === "ERROR")) return "failing";
  if (statuses.some((s) => s === "PENDING" || s === "IN_PROGRESS" || s === "QUEUED" || s === "EXPECTED")) {
    return "pending";
  }
  if (statuses.every((s) => ["SUCCESS", "COMPLETED", "SKIPPED", "NEUTRAL", ""].includes(s))) {
    return "passing";
  }
  return "pending";
}

/**
 * Extract the full GitHub repo slug (e.g. "org/reponame") from a remote URL.
 */
export function extractRepoSlug(remoteUrl: string): string | null {
  // HTTPS: https://token@github.com/org/repo.git or https://github.com/org/repo
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  // SSH: git@github.com:org/repo.git
  const sshMatch = remoteUrl.match(/github\.com:([^/]+\/[^/.]+)(\.git)?$/);
  if (sshMatch) return sshMatch[1];
  return null;
}

/**
 * Extract an embedded token from a remote URL.
 * Handles formats like https://x-access-token:TOKEN@github.com/...
 * and https://TOKEN@github.com/...
 */
export function extractTokenFromUrl(remoteUrl: string): string | null {
  const match = remoteUrl.match(/https?:\/\/(?:[^:]+:)?([^@]+)@github\.com/);
  return match?.[1] ?? null;
}

/**
 * Resolve the best available GitHub token for a repo.
 * Priority: repo PAT > URL-embedded token > .repo-token file > env var.
 */
function resolveGhToken(repoName: string, remoteUrl: string): string | null {
  // 1. Repo-specific PAT (set via UI)
  const pat = getRepoPat(repoName) ?? null;
  if (pat) return pat;

  // 2. Token embedded in the remote URL
  const urlToken = extractTokenFromUrl(remoteUrl);
  if (urlToken) return urlToken;

  // 3. Shared .repo-token file
  try {
    const repoToken = fs.readFileSync(path.join(PERSISTENT_REPOS, ".repo-token"), "utf8").trim();
    if (repoToken) return repoToken;
  } catch {
    // not available
  }

  // 4. Environment variable
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
}

/**
 * Get the remote URL for a repo directory.
 */
async function getRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "remote", "get-url", "origin"], {
      encoding: "utf-8",
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Fetch open PRs for a single repo slug using the gh CLI.
 */
async function fetchPRsForRepo(repoSlug: string, _repoName: string, ghToken?: string | null): Promise<GhPR[]> {
  try {
    const env = ghToken ? { ...process.env, GH_TOKEN: ghToken } : undefined;
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repoSlug,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        [
          "number",
          "title",
          "url",
          "headRefName",
          "baseRefName",
          "isDraft",
          "state",
          "author",
          "createdAt",
          "updatedAt",
          "reviewDecision",
          "additions",
          "deletions",
          "statusCheckRollup",
          "labels",
        ].join(","),
      ],
      { encoding: "utf-8", timeout: 30_000, env },
    );

    return JSON.parse(stdout || "[]") as GhPR[];
  } catch (err) {
    logger.warn(`[pull-requests] Failed to fetch PRs for ${repoSlug}:`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Build a map of branch name → agent for fast cross-referencing.
 */
function buildBranchAgentMap(agentManager: AgentManager): Map<string, { id: string; name: string }> {
  const map = new Map<string, { id: string; name: string }>();
  try {
    const agents = agentManager.list();
    for (const agent of agents) {
      if (agent.gitBranch) {
        map.set(agent.gitBranch, { id: agent.id, name: agent.name });
      }
    }
  } catch {
    // safe to ignore if list fails
  }
  return map;
}

/**
 * Fetch all open PRs across all repos with agent cross-referencing.
 */
async function fetchAllPRs(agentManager: AgentManager): Promise<PullRequestItem[]> {
  if (!fs.existsSync(PERSISTENT_REPOS)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(PERSISTENT_REPOS).filter((f) => {
      try {
        const stat = fs.statSync(path.join(PERSISTENT_REPOS, f));
        return stat.isDirectory() && f !== "hooks";
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }

  const repoInfos = await Promise.all(
    entries.map(async (entry) => {
      const repoPath = path.join(PERSISTENT_REPOS, entry);
      const remoteUrl = await getRemoteUrl(repoPath);
      if (!remoteUrl) return null;
      const slug = extractRepoSlug(remoteUrl);
      if (!slug) return null;
      const name = entry.replace(/\.git$/, "");
      const token = resolveGhToken(name, remoteUrl);
      return { name, slug, token };
    }),
  );

  const validRepos = repoInfos.filter((r): r is { name: string; slug: string; token: string | null } => r !== null);
  if (validRepos.length === 0) return [];

  const branchMap = buildBranchAgentMap(agentManager);

  const prArrays = await Promise.all(
    validRepos.map(async ({ name, slug, token }) => {
      const ghPRs = await fetchPRsForRepo(slug, name, token);
      return ghPRs.map((gh): PullRequestItem => {
        const isDraft = gh.isDraft;
        const state: PullRequestItem["state"] = isDraft
          ? "draft"
          : gh.state === "MERGED"
            ? "merged"
            : gh.state === "CLOSED"
              ? "closed"
              : "open";

        const agent = branchMap.get(gh.headRefName) ?? null;

        return {
          number: gh.number,
          title: gh.title,
          url: gh.url,
          state,
          branch: gh.headRefName,
          baseBranch: gh.baseRefName,
          author: gh.author?.name ?? gh.author?.login ?? "unknown",
          repo: name,
          isDraft,
          additions: gh.additions ?? 0,
          deletions: gh.deletions ?? 0,
          checksStatus: deriveChecksStatus(gh.statusCheckRollup),
          reviewDecision: gh.reviewDecision ?? "",
          createdAt: gh.createdAt,
          updatedAt: gh.updatedAt,
          agent,
          labels: (gh.labels ?? []).map((l) => l.name),
        };
      });
    }),
  );

  return prArrays.flat();
}

export function createPullRequestsRouter(agentManager: AgentManager) {
  const router = express.Router();

  /**
   * GET /api/pull-requests
   *
   * Returns all open PRs across all repos with agent cross-references.
   * Results are cached for 30 seconds.
   *
   * Query params:
   *   - refresh=true  force-invalidate the cache
   */
  router.get("/api/pull-requests", async (req: Request, res: Response) => {
    try {
      const forceRefresh = req.query.refresh === "true";
      const now = Date.now();

      if (!forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
        res.json({
          pullRequests: cache.prs,
          cachedAt: cache.fetchedAt,
          fromCache: true,
        });
        return;
      }

      const prs = await fetchAllPRs(agentManager);
      cache = { prs, fetchedAt: now };

      res.json({ pullRequests: prs, cachedAt: now, fromCache: false });
    } catch (err) {
      logger.error("[pull-requests] Failed to list pull requests:", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Failed to list pull requests" });
    }
  });

  return router;
}
