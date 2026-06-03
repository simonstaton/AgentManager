/**
 * Workflow Validators & Parsers
 *
 * Pure functions for validating and parsing inputs used in Linear workflow automation.
 * VP-1: parseLinearUrl       — comprehensive URL parsing with validation
 * VP-2: validateGitHubPatScopes — GitHub PAT scope verification (repo access)
 * VP-3: validateLinearApiKey — Linear API key format + auth check
 * VP-4: estimateWorkflowCost — cost estimation by issue size and model
 */

import { type AllowedModel, DEFAULT_MODEL, MODELS } from "./models";
import { validateToken } from "./token-validation";

export interface ParsedLinearUrl {
  issueId: string;
  team: string;
  workspace: string;
  safeUrl: string;
}

export type LinearUrlErrorCode =
  | "EMPTY"
  | "INVALID_FORMAT"
  | "NOT_HTTPS"
  | "WRONG_DOMAIN"
  | "INVALID_PATH"
  | "INVALID_WORKSPACE"
  | "INVALID_ISSUE_ID";

export type LinearUrlParseResult =
  | { ok: true; parsed: ParsedLinearUrl }
  | { ok: false; code: LinearUrlErrorCode; error: string };

export interface GitHubPatValidationResult {
  valid: boolean;
  login?: string;
  scopes?: string[];
  missingScopes?: string[];
  error?: string;
}

export interface LinearApiKeyValidationResult {
  valid: boolean;
  user?: string;
  error?: string;
}

export type IssueSize = "XS" | "S" | "M" | "L" | "XL";

export type SupportedModel = AllowedModel;

export interface CostEstimate {
  size: IssueSize;
  model: SupportedModel;
  agentCount: number;
  minCostUsd: number;
  maxCostUsd: number;
  signals: string[];
}

const WORKSPACE_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
const ISSUE_ID_RE = /^[A-Z][A-Z0-9]*-\d+$/;

export function parseLinearUrl(rawUrl: string): LinearUrlParseResult {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { ok: false, code: "EMPTY", error: "URL is required" };
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false, code: "INVALID_FORMAT", error: "Invalid URL format" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, code: "NOT_HTTPS", error: "URL must use HTTPS" };
  }

  if (url.hostname !== "linear.app") {
    return { ok: false, code: "WRONG_DOMAIN", error: "URL host must be linear.app" };
  }

  const pathname = url.pathname.replace(/\/$/, "");
  const segments = pathname.split("/");
  if (segments.length !== 4 || segments[2] !== "issue") {
    return {
      ok: false,
      code: "INVALID_PATH",
      error: "Invalid Linear URL path. Expected: https://linear.app/{workspace}/issue/{TEAM-NNN}",
    };
  }

  const workspace = segments[1];
  const rawIssueId = segments[3];

  if (!workspace || !WORKSPACE_RE.test(workspace)) {
    return { ok: false, code: "INVALID_WORKSPACE", error: "Invalid workspace slug in URL" };
  }

  const issueId = rawIssueId.toUpperCase();
  if (!ISSUE_ID_RE.test(issueId)) {
    return {
      ok: false,
      code: "INVALID_ISSUE_ID",
      error: "Invalid issue ID format. Expected TEAM-NNN (e.g. ENG-123)",
    };
  }

  const team = issueId.split("-")[0];
  const safeUrl = `https://linear.app/${workspace}/issue/${issueId}`;

  return { ok: true, parsed: { issueId, team, workspace, safeUrl } };
}

const ACCEPTABLE_REPO_SCOPES = ["repo", "public_repo"] as const;

export async function validateGitHubPatScopes(token: string): Promise<GitHubPatValidationResult> {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Token is required" };
  }

  if (!/^(ghp_|github_pat_)[A-Za-z0-9_]+$/.test(token)) {
    return {
      valid: false,
      error: "Token does not appear to be a GitHub PAT (expected ghp_ or github_pat_ prefix)",
    };
  }

  const result = await validateToken("github", token);
  if (!result.valid) {
    return { valid: false, error: result.error ?? "GitHub authentication failed" };
  }

  const scopes = result.scopes ?? [];
  const hasRepoAccess = ACCEPTABLE_REPO_SCOPES.some((s) => scopes.includes(s));

  if (!hasRepoAccess) {
    const missingScopes = ["repo"];
    return {
      valid: false,
      login: result.user,
      scopes,
      missingScopes,
      error: `Token is missing required scope: repo. Current scopes: ${scopes.join(", ") || "(none)"}. Add the 'repo' scope and regenerate the token.`,
    };
  }

  return { valid: true, login: result.user, scopes };
}

const LINEAR_API_KEY_RE = /^lin_api_[A-Za-z0-9]{32,}$/;

export async function validateLinearApiKey(token: string): Promise<LinearApiKeyValidationResult> {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Token is required" };
  }

  if (!LINEAR_API_KEY_RE.test(token)) {
    return {
      valid: false,
      error: 'Linear API key must start with "lin_api_" followed by at least 32 alphanumeric characters',
    };
  }

  const result = await validateToken("linear", token);
  if (!result.valid) {
    return { valid: false, error: result.error ?? "Linear API authentication failed" };
  }

  return { valid: true, user: result.user };
}

const SIZE_BASE_COSTS: Record<IssueSize, { minUsd: number; maxUsd: number; agentCount: number; signals: string[] }> = {
  XS: {
    minUsd: 0.05,
    maxUsd: 0.3,
    agentCount: 1,
    signals: ["Single function or trivial change", "Known solution path, no exploration needed"],
  },
  S: {
    minUsd: 0.2,
    maxUsd: 0.8,
    agentCount: 2,
    signals: ["1–3 files to change", "Clear specification with well-defined scope"],
  },
  M: {
    minUsd: 0.8,
    maxUsd: 3.0,
    agentCount: 4,
    signals: ["5–10 files to change", "Some codebase exploration needed"],
  },
  L: {
    minUsd: 2.5,
    maxUsd: 7.0,
    agentCount: 6,
    signals: ["Multi-module changes", "Architecture decision or significant refactor required"],
  },
  XL: {
    minUsd: 6.0,
    maxUsd: 20.0,
    agentCount: 10,
    signals: ["Cross-system feature or epic", "Requires multiple sub-issue implementations"],
  },
};

const MODEL_COST_MULTIPLIERS: Record<SupportedModel, number> = Object.fromEntries(
  Object.entries(MODELS).map(([id, m]) => [id, m.costMultiplier]),
) as Record<SupportedModel, number>;

const COST_BUFFER_MULTIPLIER = 1.2;

export function estimateWorkflowCost(size: IssueSize, model: SupportedModel = DEFAULT_MODEL): CostEstimate {
  const base = SIZE_BASE_COSTS[size];
  const multiplier = MODEL_COST_MULTIPLIERS[model];

  const minCostUsd = Math.round(base.minUsd * multiplier * COST_BUFFER_MULTIPLIER * 100) / 100;
  const maxCostUsd = Math.round(base.maxUsd * multiplier * COST_BUFFER_MULTIPLIER * 100) / 100;

  return {
    size,
    model,
    agentCount: base.agentCount,
    minCostUsd,
    maxCostUsd,
    signals: base.signals,
  };
}
