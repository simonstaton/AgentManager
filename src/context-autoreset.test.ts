import { describe, expect, it } from "vitest";
import {
  COMPACT_COMMAND,
  ContextAutoResetManager,
  contextFillRatio,
  DEFAULT_AUTORESET_THRESHOLD,
  shouldAutoReset,
} from "./context-autoreset";

describe("constants", () => {
  it("COMPACT_COMMAND is /compact", () => {
    expect(COMPACT_COMMAND).toBe("/compact");
  });

  it("DEFAULT_AUTORESET_THRESHOLD is in (0,1]", () => {
    expect(DEFAULT_AUTORESET_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_AUTORESET_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe("contextFillRatio", () => {
  it("returns ratio correctly", () => {
    expect(contextFillRatio({ lastTurnTokensIn: 72_000, tokenLimit: 100_000 })).toBeCloseTo(0.72);
  });

  it("returns 0 when tokenLimit is 0", () => {
    expect(contextFillRatio({ lastTurnTokensIn: 1000, tokenLimit: 0 })).toBe(0);
  });
});

describe("shouldAutoReset", () => {
  const cfg = { enabled: true, threshold: 0.72, cooldownTurns: 3 };

  it("returns true when ratio exceeds threshold and cooldown elapsed", () => {
    expect(shouldAutoReset(0.8, cfg, Infinity)).toBe(true);
  });

  it("returns false when disabled", () => {
    expect(shouldAutoReset(0.9, { ...cfg, enabled: false }, Infinity)).toBe(false);
  });

  it("returns false when ratio below threshold", () => {
    expect(shouldAutoReset(0.5, cfg, Infinity)).toBe(false);
  });

  it("returns false when within cooldown", () => {
    expect(shouldAutoReset(0.9, cfg, 2)).toBe(false);
  });

  it("returns true when exactly at cooldown boundary", () => {
    expect(shouldAutoReset(0.9, cfg, 3)).toBe(true);
  });
});

describe("ContextAutoResetManager", () => {
  it("fires reset when gauge is over threshold", () => {
    const mgr = new ContextAutoResetManager(() => ({ enabled: true, threshold: 0.72, cooldownTurns: 1 }));
    const reading = { lastTurnTokensIn: 90_000, tokenLimit: 100_000 };
    expect(mgr.onIdleTick("agent1", reading)).toBe(true);
  });

  it("respects cooldown on consecutive ticks", () => {
    const mgr = new ContextAutoResetManager(() => ({ enabled: true, threshold: 0.72, cooldownTurns: 3 }));
    const reading = { lastTurnTokensIn: 90_000, tokenLimit: 100_000 };
    expect(mgr.onIdleTick("agent1", reading)).toBe(true); // fires
    expect(mgr.onIdleTick("agent1", reading)).toBe(false); // cooldown
    expect(mgr.onIdleTick("agent1", reading)).toBe(false); // cooldown
    expect(mgr.onIdleTick("agent1", reading)).toBe(true); // fires again after 3 ticks
  });

  it("forget removes state so next tick can fire again", () => {
    const mgr = new ContextAutoResetManager(() => ({ enabled: true, threshold: 0.5, cooldownTurns: 5 }));
    const reading = { lastTurnTokensIn: 90_000, tokenLimit: 100_000 };
    expect(mgr.onIdleTick("agent1", reading)).toBe(true);
    expect(mgr.onIdleTick("agent1", reading)).toBe(false);
    mgr.forget("agent1");
    expect(mgr.onIdleTick("agent1", reading)).toBe(true);
  });
});
