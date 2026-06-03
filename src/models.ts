export interface ModelPricing {
  /** Per-million input tokens (USD) */
  input: number;
  /** Per-million output tokens (USD) */
  output: number;
  /** Per-million cache-read tokens (USD) */
  cacheRead: number;
  /** Per-million cache-write tokens (USD) */
  cacheWrite: number;
}

export interface ModelDef {
  displayName: string;
  tokenLimit: number;
  pricing: ModelPricing;
  /** Cost multiplier relative to Sonnet 4.6 (= 1.0). */
  costMultiplier: number;
}

export const MODELS = {
  "claude-opus-4-8-20260601": {
    displayName: "Opus 4.8",
    tokenLimit: 1_000_000,
    pricing: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    costMultiplier: 1.67,
  },
  "claude-opus-4-7-20260601": {
    displayName: "Opus 4.7",
    tokenLimit: 1_000_000,
    pricing: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    costMultiplier: 1.67,
  },
  "claude-opus-4-6": {
    displayName: "Opus 4.6",
    tokenLimit: 1_000_000,
    pricing: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    costMultiplier: 1.67,
  },
  "claude-sonnet-4-6": {
    displayName: "Sonnet 4.6",
    tokenLimit: 1_000_000,
    pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    costMultiplier: 1.0,
  },
  "claude-sonnet-4-5-20250929": {
    displayName: "Sonnet 4.5",
    tokenLimit: 200_000,
    pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    costMultiplier: 1.0,
  },
  "claude-haiku-4-5-20251001": {
    displayName: "Haiku 4.5",
    tokenLimit: 200_000,
    pricing: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    costMultiplier: 0.33,
  },
} as const satisfies Record<string, ModelDef>;

export type AllowedModel = keyof typeof MODELS;

export function isOpusModel(model: string): boolean {
  return model.startsWith("claude-opus");
}

export const DEFAULT_MODEL: AllowedModel = "claude-sonnet-4-6";

export const SMALL_FAST_MODEL: AllowedModel = "claude-haiku-4-5-20251001";
