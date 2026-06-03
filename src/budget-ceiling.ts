/**
 * Global spend ceiling — the container-level backstop against runaway overnight
 * cost (the "$800 night"). Per-agent caps bound individual agents; this bounds
 * the whole fleet's spend over a rolling window.
 *
 * Pure evaluation lives in `evaluateBudgetCeiling`; `BudgetCeilingMonitor` adds
 * edge-triggered alerting (each threshold fires once until spend drops back
 * below it, so a new window re-alerts rather than spamming every tick).
 */

/** Alert thresholds as a percentage of the ceiling. 100 = the hard block. */
export const BUDGET_ALERT_LEVELS = [50, 80, 100] as const;

export interface BudgetCeilingEvaluation {
  /** Spend as a fraction of the ceiling (0..1+). 0 when the ceiling is disabled. */
  ratio: number;
  /** True once spend has reached the ceiling — new spawns should be refused. */
  blocked: boolean;
  /** Highest alert level (50/80/100) currently reached, or 0 if none. */
  level: number;
}

/**
 * Evaluate spend against a ceiling. A ceiling <= 0 disables the feature
 * (never blocks, never alerts).
 */
export function evaluateBudgetCeiling(spentUsd: number, ceilingUsd: number): BudgetCeilingEvaluation {
  if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) {
    return { ratio: 0, blocked: false, level: 0 };
  }
  const ratio = spentUsd / ceilingUsd;
  const pct = ratio * 100;
  let level = 0;
  for (const l of BUDGET_ALERT_LEVELS) {
    if (pct >= l) level = l;
  }
  return { ratio, blocked: pct >= 100, level };
}

export interface BudgetCeilingObservation {
  blocked: boolean;
  /** A newly-crossed alert level to surface to the operator, or null. */
  crossed: number | null;
  ratio: number;
}

/**
 * Stateful wrapper that remembers the highest alert level already reported, so
 * callers polling on every spawn/cleanup tick only emit an alert when a new
 * threshold is crossed. When spend falls back below a level (e.g. a new rolling
 * window), the latch resets and that level can fire again.
 */
export class BudgetCeilingMonitor {
  private lastAlertedLevel = 0;

  observe(spentUsd: number, ceilingUsd: number): BudgetCeilingObservation {
    const { ratio, blocked, level } = evaluateBudgetCeiling(spentUsd, ceilingUsd);
    let crossed: number | null = null;
    if (level > this.lastAlertedLevel) crossed = level;
    this.lastAlertedLevel = level;
    return { blocked, crossed, ratio };
  }

  /** Reset the alert latch (e.g. when the ceiling is reconfigured). */
  reset(): void {
    this.lastAlertedLevel = 0;
  }
}
