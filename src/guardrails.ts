export const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+\/(?!\s|tmp)/i,
  /DROP\s+(TABLE|DATABASE)/i,
  /DELETE\s+FROM\s+\w+/i, // DELETE FROM anywhere (not just at end)
  /mongodb(\+srv)?:\/\//i,
  /postgres(ql)?:\/\//i,
  /mysql:\/\//i,
];

export const ALLOWED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
];
export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export const MAX_PROMPT_LENGTH = 100_000;
export const MAX_TURNS = 500;
export const MAX_AGENTS = 20;
export const MAX_BATCH_SIZE = 10;
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
