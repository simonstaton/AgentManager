import { logger } from "./logger";

/**
 * Gauge-driven proactive context auto-reset .
 *
 * The platform keeps a long-running agent's context within a healthy operating
 * band with zero human or LLM action. Between an agent's turns (the onIdle
 * control point) we read its live context gauge — last-turn input tokens over
 * the model's token limit — and, if it has crossed the operating-band ceiling,
 * we proactively issue a manual `/compact` before the agent's next turn.
 *
 * v1 scope guard: `/compact` via onIdle ONLY. No clearContext(), no hooks, no
 * re-parenting/handoff/relay — those are gated and out of scope (see stream §14).
 *
 * A per-agent cooldown prevents the reset from re-firing on consecutive turns:
 * after a `/compact` is issued we suppress further resets for the agent until at
 * least COOLDOWN_TURNS onIdle transitions have elapsed, giving the compaction
 * time to land and the gauge time to fall.
 */

/** The `/compact` slash command issued to an over-band agent. */
export const COMPACT_COMMAND = "/compact";

/**
 * Default operating-band ceiling as a fraction of the token limit. When the
 * gauge crosses this, a reset is issued. Tunable via the context-policy store
 * (when present) or the CONTEXT_AUTORESET_THRESHOLD env var.
 */
export const DEFAULT_AUTORESET_THRESHOLD = 0.72;

/**
 * Default number of onIdle transitions that must elapse after a reset before
 * another may fire for the same agent. Tunable via CONTEXT_AUTORESET_COOLDOWN_TURNS.
 */
export const DEFAULT_COOLDOWN_TURNS = 3;

/** Resolved, effective auto-reset configuration. */
export interface AutoResetConfig {
  /** Master on/off switch. When false, no resets are ever issued. */
  enabled: boolean;
  /** Operating-band ceiling as a fraction of the token limit (0..1). */
  threshold: number;
  /** onIdle transitions to wait after a reset before another may fire. */
  cooldownTurns: number;
}

/**
 * Resolve the effective auto-reset config.
 *
 * Prefers the context-policy store (tech-lead's src/context-policy-store.ts,
 * built in parallel under stream §14-backend) when it is available on this
 * build; otherwise falls back to env vars and the hardcoded defaults above.
 *
 * The store is imported lazily and defensively so this module never fails to
 * load when the store is absent.
 *
 * Follow-up : once context-policy-store.ts lands, replace
 * the dynamic-import probe with a direct `import { getEffectiveContextPolicy }`.
 */
export function resolveAutoResetConfig(): AutoResetConfig {
  const fromStore = tryReadPolicyStore();
  if (fromStore) return fromStore;

  const enabledEnv = process.env.CONTEXT_AUTORESET_ENABLED;
  // Default ON — this is the headline behaviour the platform ships. Operators
  // disable it explicitly with CONTEXT_AUTORESET_ENABLED=false.
  const enabled = enabledEnv === undefined ? true : enabledEnv === "true";

  const threshold = clampFraction(
    Number.parseFloat(process.env.CONTEXT_AUTORESET_THRESHOLD ?? ""),
    DEFAULT_AUTORESET_THRESHOLD,
  );

  const cooldownTurns = clampCooldown(
    Number.parseInt(process.env.CONTEXT_AUTORESET_COOLDOWN_TURNS ?? "", 10),
    DEFAULT_COOLDOWN_TURNS,
  );

  return { enabled, threshold, cooldownTurns };
}

/** A minimal shape of what the policy store is expected to return, kept local
 *  so we do not create a hard dependency on a module that may not exist yet. */
interface PolicyStoreShape {
  getEffectiveContextPolicy?: () => {
    autoReset?: { enabled?: boolean; threshold?: number; cooldownTurns?: number };
  };
}

/** Attempt to read config from the context-policy store if it is present. */
function tryReadPolicyStore(): AutoResetConfig | null {
  let store: PolicyStoreShape | undefined;
  try {
    // Use require so a missing module degrades to a catchable error rather than
    // a top-level import failure. The store is optional on this build.
    store = require("./context-policy-store") as PolicyStoreShape;
  } catch {
    return null;
  }
  if (!store?.getEffectiveContextPolicy) return null;

  try {
    const policy = store.getEffectiveContextPolicy().autoReset ?? {};
    return {
      enabled: policy.enabled ?? true,
      threshold: clampFraction(policy.threshold ?? Number.NaN, DEFAULT_AUTORESET_THRESHOLD),
      cooldownTurns: clampCooldown(policy.cooldownTurns ?? Number.NaN, DEFAULT_COOLDOWN_TURNS),
    };
  } catch (err: unknown) {
    logger.warn("[context-autoreset] policy store read failed, using defaults", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Clamp a fraction to (0, 1]; fall back when NaN/out of range. */
function clampFraction(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) return fallback;
  return value;
}

/** Clamp a cooldown to a non-negative integer; fall back when NaN/negative. */
function clampCooldown(value: number, fallback: number): number {
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

/** The live gauge reading needed to make a reset decision. */
export interface GaugeReading {
  lastTurnTokensIn: number;
  tokenLimit: number;
}

/**
 * Compute the context-fill fraction (0..1+) from a gauge reading.
 * Returns 0 when the limit is non-positive (avoids divide-by-zero / NaN).
 */
export function contextFillRatio(reading: GaugeReading): number {
  if (!(reading.tokenLimit > 0)) return 0;
  return reading.lastTurnTokensIn / reading.tokenLimit;
}

/**
 * Pure decision: should a reset be issued for an agent right now?
 *
 * @param ratio       current context-fill fraction (see contextFillRatio)
 * @param config      effective auto-reset config
 * @param turnsSinceLastReset  onIdle transitions since this agent's last reset
 *                             (Number.POSITIVE_INFINITY if it has never fired)
 */
export function shouldAutoReset(ratio: number, config: AutoResetConfig, turnsSinceLastReset: number): boolean {
  if (!config.enabled) return false;
  if (ratio < config.threshold) return false;
  // Cooldown: suppress until enough idle transitions have elapsed since the
  // last reset. A reset that has never fired has turnsSinceLastReset = Infinity.
  if (turnsSinceLastReset < config.cooldownTurns) return false;
  return true;
}

/**
 * Tracks per-agent cooldown state across onIdle transitions and decides when to
 * fire a proactive reset. Stateful; one instance per process.
 */
export class ContextAutoResetManager {
  /** onIdle transition counter per agent (monotonically increasing). */
  private idleTicks = new Map<string, number>();
  /** The idleTick value at which each agent last fired a reset. */
  private lastResetTick = new Map<string, number>();

  constructor(private readonly resolveConfig: () => AutoResetConfig = resolveAutoResetConfig) {}

  /**
   * Record an onIdle transition for an agent and decide whether to reset.
   * Returns true when the caller should issue a `/compact`.
   *
   * Call exactly once per onIdle event for the agent, BEFORE issuing the reset.
   */
  onIdleTick(agentId: string, reading: GaugeReading | null): boolean {
    const tick = (this.idleTicks.get(agentId) ?? 0) + 1;
    this.idleTicks.set(agentId, tick);

    if (!reading) return false;

    const config = this.resolveConfig();
    const lastTick = this.lastResetTick.get(agentId);
    const turnsSinceLastReset = lastTick === undefined ? Number.POSITIVE_INFINITY : tick - lastTick;
    const ratio = contextFillRatio(reading);

    const fire = shouldAutoReset(ratio, config, turnsSinceLastReset);
    if (fire) {
      this.lastResetTick.set(agentId, tick);
      logger.info("[context-autoreset] gauge crossed operating band; issuing /compact", {
        agentId,
        ratioPct: Math.round(ratio * 100),
        thresholdPct: Math.round(config.threshold * 100),
      });
    }
    return fire;
  }

  /** Forget an agent's cooldown state (e.g. when it is destroyed). */
  forget(agentId: string): void {
    this.idleTicks.delete(agentId);
    this.lastResetTick.delete(agentId);
  }
}
