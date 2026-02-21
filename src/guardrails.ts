export const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /rm\s+(-rf?|--recursive)\s+\/(?!\s|tmp)/i,
  // Require SQL context (semicolon) to avoid blocking e.g. "delete from the list", "DROP TABLE documentation"
  /DROP\s+(TABLE|DATABASE)\s+\w+\s*;/i,
  /DELETE\s+FROM\s+\w+\s*(;|WHERE)/i,
  /mongodb(\+srv)?:\/\//i,
  /postgres(ql)?:\/\//i,
  /mysql:\/\//i,
  // Block high-impact irreversible operations
  /gh\s+pr\s+merge/i,
  /gh\s+pr\s+approve/i,
  /gcloud\s+.*\s+deploy/i,
  /terraform\s+(apply|destroy)/i,
  /git\s+push\s+.*--force/i,
];

/** Returns true if the text matches any blocked command pattern. */
export function promptContainsBlockedContent(text: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some((p) => p.test(text));
}

export const ALLOWED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
];
export const DEFAULT_MODEL = "claude-sonnet-4-6";

export let MAX_PROMPT_LENGTH = 100_000;
export let MAX_TURNS = 500;
export let MAX_AGENTS = 100;
export let MAX_BATCH_SIZE = 10;
export let SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Spawning depth limits - stored as an immutable field on Agent at
// creation time. Walking the parent chain at runtime is bypassable if a parent
// is destroyed (chain breaks, depth resets to 0).
export let MAX_AGENT_DEPTH = 3;
export let MAX_CHILDREN_PER_AGENT = 20;

/** Bounds for guardrail setters and config route validation (single source of truth). */
export const BOUNDS = {
  maxPromptLength: [1_000, 1_000_000],
  maxTurns: [1, 10_000],
  maxAgents: [1, 100],
  maxBatchSize: [1, 50],
  maxAgentDepth: [1, 10],
  maxChildrenPerAgent: [1, 20],
  sessionTtlMs: [60_000, 24 * 60 * 60 * 1000],
} as const;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// Setters - ES module namespace objects are read-only, so external modules
// must call these instead of assigning to the exports directly.
export function setMaxPromptLength(v: number) {
  const [min, max] = BOUNDS.maxPromptLength;
  MAX_PROMPT_LENGTH = clamp(v, min, max);
}
export function setMaxTurns(v: number) {
  const [min, max] = BOUNDS.maxTurns;
  MAX_TURNS = clamp(v, min, max);
}
export function setMaxAgents(v: number) {
  const [min, max] = BOUNDS.maxAgents;
  MAX_AGENTS = clamp(v, min, max);
}
export function setMaxBatchSize(v: number) {
  const [min, max] = BOUNDS.maxBatchSize;
  MAX_BATCH_SIZE = clamp(v, min, max);
}
export function setSessionTtlMs(v: number) {
  const [min, max] = BOUNDS.sessionTtlMs;
  SESSION_TTL_MS = clamp(v, min, max);
}
export function setMaxAgentDepth(v: number) {
  const [min, max] = BOUNDS.maxAgentDepth;
  MAX_AGENT_DEPTH = clamp(v, min, max);
}
export function setMaxChildrenPerAgent(v: number) {
  const [min, max] = BOUNDS.maxChildrenPerAgent;
  MAX_CHILDREN_PER_AGENT = clamp(v, min, max);
}
