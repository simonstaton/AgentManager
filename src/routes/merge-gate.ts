/**
 * Merge Gate — confidence-based PR merge barrier.
 *
 * Agents are blocked from running `gh pr merge` directly (Layer 5 guardrail).
 * Instead, they must use this endpoint which checks the PR's confidence label
 * before allowing the merge to proceed.
 *
 * Policy:
 *   - confidence: high   → merge allowed (agent can auto-merge)
 *   - confidence: medium  → merge blocked (human review recommended)
 *   - confidence: low     → merge blocked (human review required)
 *   - confidence: critical → merge blocked (human review required)
 *   - no label            → merge blocked (confidence score not yet computed)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express, { type Request, type Response } from "express";
import type { AgentManager } from "../agents";
import { logger } from "../logger";
import {
  type ConfidenceLabel,
  GATE_CONFIDENCE_LEVELS,
  type RepoGateConfig,
  resolveEffectiveGateConfig,
} from "../repo-gate-store";
import type { AuthenticatedRequest } from "../types";
import { param } from "../utils/express";
import { sanitizeRepoName } from "../validation";

const execFileAsync = promisify(execFile);

/** Confidence levels ordered from safest to riskiest. Re-exported for callers. */
export const CONFIDENCE_LEVELS = GATE_CONFIDENCE_LEVELS;
export type { ConfidenceLabel };

/** The minimum confidence level required for agent auto-merge. */
export const AUTO_MERGE_THRESHOLD: ConfidenceLabel = "high";

/** Map confidence levels to human-readable merge policy descriptions. */
const MERGE_POLICY: Record<ConfidenceLabel, { allowed: boolean; reason: string }> = {
  high: { allowed: true, reason: "High confidence — auto-merge permitted" },
  medium: { allowed: false, reason: "Medium confidence — human review recommended before merge" },
  low: { allowed: false, reason: "Low confidence — human review required before merge" },
  critical: {
    allowed: false,
    reason: "Critical confidence — human review required, PR should not be merged without thorough review",
  },
};

/**
 * Extract the confidence label from a PR's labels.
 * If multiple confidence labels exist, returns the most restrictive (lowest confidence).
 * Returns null if no confidence label is found.
 */
export function parseConfidenceLabel(labels: string[]): ConfidenceLabel | null {
  let worst: ConfidenceLabel | null = null;
  let worstIndex = -1;

  for (const label of labels) {
    const normalized = label.trim().toLowerCase();
    for (let i = 0; i < CONFIDENCE_LEVELS.length; i++) {
      if (normalized === `confidence: ${CONFIDENCE_LEVELS[i]}`) {
        if (i > worstIndex) {
          worst = CONFIDENCE_LEVELS[i];
          worstIndex = i;
        }
      }
    }
  }
  return worst;
}

/**
 * Check whether a merge is allowed for the given confidence level.
 */
export function isMergeAllowed(confidence: ConfidenceLabel): boolean {
  return MERGE_POLICY[confidence]?.allowed ?? false;
}

/**
 * Get the merge policy details for a confidence level.
 * If an effective repo config is provided, its mergePolicy overrides the builtin.
 */
export function getMergePolicy(
  confidence: ConfidenceLabel,
  effective?: Pick<RepoGateConfig, "mergePolicy" | "autoMergeThreshold">,
): { allowed: boolean; reason: string } {
  return effective?.mergePolicy?.[confidence] ?? MERGE_POLICY[confidence];
}

/**
 * Extract the short repo name from an "owner/repo" string.
 * Returns the sanitized repo name (e.g. "fanvue/AgentManager" → "AgentManager").
 */
export function repoKeyFromOwnerRepo(ownerRepo: string): string {
  const slash = ownerRepo.lastIndexOf("/");
  const name = slash >= 0 ? ownerRepo.slice(slash + 1) : ownerRepo;
  return sanitizeRepoName(name);
}

/** Validate PR number: must be a positive integer. */
function isValidPrNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Validate repo name: owner/repo format. */
function isValidRepo(value: unknown): value is string {
  return typeof value === "string" && /^[\w.-]+\/[\w.-]+$/.test(value);
}

/**
 * Fetch PR labels from GitHub using the gh CLI.
 * Returns the list of label names or throws on failure.
 */
export async function fetchPrLabels(prNumber: number, repo: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "gh",
    ["pr", "view", String(prNumber), "--repo", repo, "--json", "labels", "--jq", ".labels[].name"],
    { encoding: "utf-8", timeout: 15_000 },
  );
  return stdout
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

/**
 * Execute a PR merge via the gh CLI.
 * Uses --squash by default for clean history.
 */
async function executeMerge(prNumber: number, repo: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "gh",
    ["pr", "merge", String(prNumber), "--repo", repo, "--squash", "--delete-branch"],
    { encoding: "utf-8", timeout: 30_000 },
  );
  return stdout.trim();
}

export function createMergeGateRouter(agentManager: AgentManager) {
  const router = express.Router();

  /**
   * POST /api/merge-gate
   *
   * Check confidence and optionally merge a PR.
   *
   * Body: { prNumber: number, repo: string, dryRun?: boolean }
   *
   * - dryRun: true  → only check if merge would be allowed (no actual merge)
   * - dryRun: false → check and perform the merge if allowed (default)
   *
   * Returns:
   *   200 { allowed: true, merged: boolean, confidence, reason }
   *   403 { allowed: false, confidence, reason }  — merge blocked
   *   400 { error } — invalid input or no confidence label
   *   502 { error } — GitHub API failure
   */
  router.post("/api/merge-gate", async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;

    // Agent-service tokens are blocked by default, unless the specific agent
    // was spawned with allowMergeGate: true.
    if (user?.sub === "agent-service") {
      const agentId = user.agentId;
      const agent = agentId ? agentManager.get(agentId) : undefined;
      if (!agent?.allowMergeGate) {
        res
          .status(403)
          .json({ error: "Agent service tokens cannot trigger merges. Spawn with allowMergeGate to enable." });
        return;
      }
      logger.info("[merge-gate] Agent with allowMergeGate is requesting merge", { agentId });
    }

    const { prNumber, repo, dryRun } = req.body ?? {};

    if (!isValidPrNumber(prNumber)) {
      res.status(400).json({ error: "prNumber is required and must be a positive integer" });
      return;
    }

    if (!isValidRepo(repo)) {
      res.status(400).json({ error: "repo is required in owner/repo format" });
      return;
    }

    const isDryRun = dryRun === true;

    // Fetch PR labels from GitHub
    let labels: string[];
    try {
      labels = await fetchPrLabels(prNumber, repo);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[merge-gate] Failed to fetch PR labels", { prNumber, repo, error: msg });
      res.status(502).json({ error: `Failed to fetch PR labels from GitHub: ${msg}` });
      return;
    }

    // Parse the confidence label
    const confidence = parseConfidenceLabel(labels);

    if (!confidence) {
      logger.warn("[merge-gate] No confidence label found on PR", { prNumber, repo, labels });
      res.status(400).json({
        error: "No confidence label found on this PR. The confidence score CI check may not have run yet.",
        labels,
      });
      return;
    }

    // Resolve per-repo gate config (fail-safe: defaults on any error)
    const repoKey = repoKeyFromOwnerRepo(repo);
    const effective = resolveEffectiveGateConfig(repoKey);
    const policy = getMergePolicy(confidence, effective);

    if (!policy.allowed) {
      logger.info("[merge-gate] Merge blocked by confidence gate", {
        prNumber,
        repo,
        confidence,
        reason: policy.reason,
        requestedBy: user?.sub,
      });
      res.status(403).json({
        allowed: false,
        merged: false,
        confidence,
        reason: policy.reason,
        requiredConfidence: effective.autoMergeThreshold,
      });
      return;
    }

    // Confidence is high — merge is allowed
    if (isDryRun) {
      logger.info("[merge-gate] Dry run: merge would be allowed", { prNumber, repo, confidence });
      res.json({
        allowed: true,
        merged: false,
        confidence,
        reason: policy.reason,
        dryRun: true,
      });
      return;
    }

    // Execute the merge
    try {
      const output = await executeMerge(prNumber, repo);
      logger.info("[merge-gate] PR merged successfully", {
        prNumber,
        repo,
        confidence,
        requestedBy: user?.sub,
      });
      res.json({
        allowed: true,
        merged: true,
        confidence,
        reason: policy.reason,
        output,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[merge-gate] Merge execution failed", { prNumber, repo, error: msg });
      res.status(502).json({
        allowed: true,
        merged: false,
        confidence,
        reason: "Merge was allowed but execution failed",
        error: msg,
      });
    }
  });

  /**
   * GET /api/merge-gate/:prNumber
   *
   * Check merge eligibility without performing a merge.
   * Query params: repo (required)
   */
  router.get("/api/merge-gate/:prNumber", async (req: Request, res: Response) => {
    const prNumber = Number.parseInt(param(req.params.prNumber), 10);
    const repo = req.query.repo as string | undefined;

    if (!isValidPrNumber(prNumber)) {
      res.status(400).json({ error: "prNumber must be a positive integer" });
      return;
    }

    if (!repo || !isValidRepo(repo)) {
      res.status(400).json({ error: "repo query parameter is required in owner/repo format" });
      return;
    }

    let labels: string[];
    try {
      labels = await fetchPrLabels(prNumber, repo);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Failed to fetch PR labels from GitHub: ${msg}` });
      return;
    }

    const confidence = parseConfidenceLabel(labels);

    if (!confidence) {
      res.status(400).json({
        error: "No confidence label found on this PR",
        labels,
      });
      return;
    }

    const policy = getMergePolicy(confidence);
    res.json({
      allowed: policy.allowed,
      confidence,
      reason: policy.reason,
      requiredConfidence: AUTO_MERGE_THRESHOLD,
      labels,
    });
  });

  return router;
}
