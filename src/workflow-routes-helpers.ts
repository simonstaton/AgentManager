import type { GradeResult } from "./grading";

/**
 * Shared types, constants, and pure helpers for the engine-backed workflow routes.
 * Extracted from routes/workflows.ts to keep the route file ≤400 lines.
 */

export interface LinearWorkflow {
  id: string;
  linearUrl: string;
  repository: string;
  status:
    | "validating"
    | "rejected"
    | "starting"
    | "running"
    | "awaiting_confirm"
    | "grading"
    | "needs_human"
    | "completed"
    | "failed"
    | "cancelled";
  agents: Array<{ id: string; name: string; role: string }>;
  hasCredentials?: boolean;
  metadata?: Record<string, unknown>;
  prUrl?: string;
  error?: string;
  costEstimate?: number;
  triageAgentId?: string;
  graderAgentId?: string;
  validation?: {
    verdict: "accept" | "accept_with_caveats" | "reject";
    clarity: "high" | "medium" | "low";
    missing: string[];
    suggestions: string[];
    readError?: "not_found" | "forbidden" | "auth_failed" | "rate_limited" | "multi_issue_empty";
    evaluatedAt: string;
  };
  grade?: GradeResult;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
}

/** Max concurrent active workflows */
export const MAX_WORKFLOWS = 5;

/** Max total stored workflows (evict oldest terminal workflows beyond this) */
export const MAX_STORED_WORKFLOWS = 50;

/** Wall-clock terminal timeout — prevents a hung manager from pinning a slot forever. */
export const RUNNING_WALL_CLOCK_TIMEOUT_MS = 60 * 60_000;

/** Supported Linear entity types */
export type LinearEntityType = "issue" | "project" | "cycle" | "view";

export interface ParsedLinearUrl {
  workspace: string;
  entityType: LinearEntityType;
  entityId: string;
  team?: string;
}

/** Validate a Linear API key format (lin_api_ prefix, min 32 chars after prefix). */
export function isValidLinearApiKey(key: string): boolean {
  return /^lin_api_[A-Za-z0-9_]{32,}$/.test(key);
}

/** Validate a GitHub PAT format (classic ghp_, fine-grained github_pat_, or legacy 40-char hex). */
export function isValidGithubPat(pat: string): boolean {
  return /^(ghp_[A-Za-z0-9]{36,}|ghs_[A-Za-z0-9]{36,}|gho_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|[a-f0-9]{40})$/.test(
    pat,
  );
}

/**
 * Parse a broad set of Linear URLs — issues, projects, cycles, views.
 * Anchored to https://linear.app to prevent spoofed domains.
 */
export function parseLinearUrl(url: string): ParsedLinearUrl | null {
  const issueMatch = url.match(/^https:\/\/linear\.app\/([\w-]+)\/issue\/([\w]+-\d+)/);
  if (issueMatch) {
    const workspace = issueMatch[1];
    const entityId = issueMatch[2];
    return { workspace, entityType: "issue", entityId, team: entityId.split("-")[0] };
  }

  const projectMatch = url.match(/^https:\/\/linear\.app\/([\w-]+)\/project\/([\w-]+)/);
  if (projectMatch) {
    return { workspace: projectMatch[1], entityType: "project", entityId: projectMatch[2] };
  }

  const cycleMatch = url.match(/^https:\/\/linear\.app\/([\w-]+)\/cycle\/([\w-]+)/);
  if (cycleMatch) {
    return { workspace: cycleMatch[1], entityType: "cycle", entityId: cycleMatch[2] };
  }

  const viewMatch = url.match(/^https:\/\/linear\.app\/([\w-]+)\/view\/([\w-]+)/);
  if (viewMatch) {
    return { workspace: viewMatch[1], entityType: "view", entityId: viewMatch[2] };
  }

  return null;
}

/** Reconstruct a clean Linear URL from parsed components (prevents prompt injection via URL). */
export function buildSafeLinearUrl(parsed: ParsedLinearUrl): string {
  return `https://linear.app/${parsed.workspace}/${parsed.entityType}/${parsed.entityId}`;
}

/** Evict oldest terminal workflows when the store exceeds MAX_STORED_WORKFLOWS. */
export function evictStaleWorkflows(workflows: Map<string, LinearWorkflow>): void {
  if (workflows.size <= MAX_STORED_WORKFLOWS) return;
  const terminal = Array.from(workflows.entries())
    .filter(([, w]) => w.status === "completed" || w.status === "failed" || w.status === "cancelled")
    .sort((a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime());
  while (workflows.size > MAX_STORED_WORKFLOWS && terminal.length > 0) {
    const oldest = terminal.shift();
    if (oldest) workflows.delete(oldest[0]);
  }
}
