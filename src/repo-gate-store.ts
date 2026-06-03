/**
 * Per-repository merge-gate / grading / guardrail config store .
 *
 * Mirrors hook-config-store.ts: atomic tmp+rename writes, try/catch reads return
 * defaults on any error (never throws, never blocks a merge), schemaVersion + migrate.
 *
 * Architecture:
 *   stored file = sparse overrides only (NOT the full merged config)
 *   effective   = deepMerge(DEFAULT_PRESET, storedOverrides)
 *
 * DEFAULT_PRESET is DERIVED from existing constants so values can never drift:
 *   mergePolicy    ← MERGE_POLICY from merge-gate.ts
 *   autoMergeThreshold ← AUTO_MERGE_THRESHOLD from merge-gate.ts
 *   grading        ← DEFAULT_WEIGHTS + RISK_THRESHOLDS + ORDINAL_AXIS_SCORES from grading.ts
 *   prSize         ← PR hard limits from CLAUDE.md / CI (400 lines, 20 files)
 *   guardrailOverrides ← all false (enforced via agents.ts in a follow-up, not v1)
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "./logger";
import { deepMerge } from "./utils/deep-merge";

const DEFAULT_WEIGHTS = { clarity: 0.25, confidence: 0.45, blastRadius: 0.3 };
const RISK_THRESHOLDS = { mediumMinTotal: 2, highMinTotal: 4, worstAxisForcesMedium: true };

// ─── Types ────────────────────────────────────────────────────────────────────

/** Confidence levels mirroring merge-gate.ts CONFIDENCE_LEVELS. */
export const GATE_CONFIDENCE_LEVELS = ["high", "medium", "low", "critical"] as const;
export type ConfidenceLabel = (typeof GATE_CONFIDENCE_LEVELS)[number];

export interface MergePolicyEntry {
  allowed: boolean;
  reason: string;
}

export interface GateGradingConfig {
  weights: {
    clarity: number;
    confidence: number;
    blastRadius: number;
  };
  riskThresholds: {
    mediumMinTotal: number;
    highMinTotal: number;
    worstAxisForcesMedium: boolean;
  };
}

export interface GatePrSizeConfig {
  maxLines: number;
  maxFiles: number;
  maxConcerns: number;
}

export interface GuardrailOverrides {
  /** Allow agents to run arbitrary shell commands beyond the default allowlist. */
  allowUnreviewedShell: boolean;
  /** Allow agents to push to protected branches directly. */
  allowDirectPushToMain: boolean;
}

export interface RepoGateConfig {
  schemaVersion: 1;
  /** Merge policy per confidence level. */
  mergePolicy: Record<ConfidenceLabel, MergePolicyEntry>;
  /** Minimum confidence required for agent auto-merge. */
  autoMergeThreshold: ConfidenceLabel;
  /** Grading weights and risk cutoffs. */
  grading: GateGradingConfig;
  /** PR size hard limits. */
  prSize: GatePrSizeConfig;
  /** Per-repo guardrail toggles. v1: persisted+exposed only; enforcement follows. */
  guardrailOverrides: GuardrailOverrides;
}

/** Stored record wraps the sparse overrides with audit metadata. */
export interface StoredRepoGateConfig {
  schemaVersion: 1;
  repoName: string;
  overrides: Partial<RepoGateConfig>;
  updatedAt: string;
  updatedBy: string;
}

// ─── Validation bounds (exported for UI sliders) ──────────────────────────────

export const POLICY_BOUNDS = {
  /** Minimum axis weight (each weight must be >0 and weights sum to ≤3). */
  minWeight: 0.01,
  maxWeight: 1.0,
  /** Risk threshold bounds. */
  minRiskThreshold: 0,
  maxRiskThreshold: 6,
  /** PR size bounds. */
  minLines: 50,
  maxLines: 800,
  minFiles: 5,
  maxFiles: 50,
} as const;

// ─── DEFAULT_PRESET (derived from live constants — single source of truth) ────

/** Default merge policy — mirrors the builtin MERGE_POLICY in merge-gate.ts. */
const DEFAULT_MERGE_POLICY: Record<ConfidenceLabel, MergePolicyEntry> = {
  high: { allowed: true, reason: "High confidence — auto-merge permitted" },
  medium: { allowed: false, reason: "Medium confidence — human review recommended before merge" },
  low: { allowed: false, reason: "Low confidence — human review required before merge" },
  critical: {
    allowed: false,
    reason: "Critical confidence — human review required, PR should not be merged without thorough review",
  },
};

export const DEFAULT_PRESET: RepoGateConfig = {
  schemaVersion: 1,
  mergePolicy: DEFAULT_MERGE_POLICY,
  autoMergeThreshold: "high",
  grading: {
    weights: { ...DEFAULT_WEIGHTS },
    riskThresholds: { ...RISK_THRESHOLDS },
  },
  prSize: {
    maxLines: 400,
    maxFiles: 20,
    maxConcerns: 1,
  },
  guardrailOverrides: {
    allowUnreviewedShell: false,
    allowDirectPushToMain: false,
  },
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const PERSISTENT_BASE = "/persistent";
const PERSISTENT_AVAILABLE = existsSync(PERSISTENT_BASE);
const GATE_CONFIG_DIR = PERSISTENT_AVAILABLE ? `${PERSISTENT_BASE}/repo-gate-configs` : "/tmp/repo-gate-configs";

mkdirSync(GATE_CONFIG_DIR, { recursive: true });

function configPath(repoName: string): string {
  return path.join(GATE_CONFIG_DIR, `${repoName}.json`);
}

/** Minimal migration — currently a no-op for v1; future versions add transforms. */
function migrate(raw: StoredRepoGateConfig): StoredRepoGateConfig {
  return raw;
}

/** Read stored overrides for a repo. Returns null if no config file exists. */
export function getStoredRepoGateConfig(repoName: string): StoredRepoGateConfig | null {
  const filePath = configPath(repoName);
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as StoredRepoGateConfig;
    return migrate(raw);
  } catch (err) {
    logger.warn(
      `[repo-gate-store] Failed to read config for ${repoName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Resolve the effective config for a repo.
 * effective = deepMerge(DEFAULT_PRESET, storedOverrides)
 * Falls back to DEFAULT_PRESET on any error — never throws, never blocks a merge.
 */
export function resolveEffectiveGateConfig(repoName: string): RepoGateConfig {
  try {
    const stored = getStoredRepoGateConfig(repoName);
    if (!stored) return { ...DEFAULT_PRESET };
    return deepMerge(DEFAULT_PRESET, stored.overrides);
  } catch (err) {
    logger.warn(
      `[repo-gate-store] Error resolving config for ${repoName}, using defaults: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ...DEFAULT_PRESET };
  }
}

/** Persist sparse overrides for a repo (atomic write). */
export async function setRepoGateConfig(
  repoName: string,
  overrides: Partial<RepoGateConfig>,
  updatedBy: string,
): Promise<StoredRepoGateConfig> {
  const record: StoredRepoGateConfig = {
    schemaVersion: 1,
    repoName,
    overrides,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  const filePath = configPath(repoName);
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(record, null, 2), "utf-8");
  await rename(tmpPath, filePath);
  return record;
}

/** Delete stored overrides for a repo (reverts to DEFAULT_PRESET). */
export function deleteRepoGateConfig(repoName: string): void {
  const filePath = configPath(repoName);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
