import { describe, expect, it, vi } from "vitest";
import { estimateCost, TOKEN_LIMITS, UsageTracker } from "./usage-tracker";

// Minimal AgentProcess stub for testing
function makeAgentProc(model: string, usage?: object) {
  return {
    agent: {
      id: "test-id",
      name: "test-agent",
      model,
      createdAt: new Date().toISOString(),
      usage: usage ?? null,
    },
    // biome-ignore lint/suspicious/noExplicitAny: test stub
  } as any;
}

// Minimal registry returning a single agent
function makeRegistry(agentProc: ReturnType<typeof makeAgentProc>) {
  const map = new Map([["test-id", agentProc]]);
  return {
    get: (id: string) => map.get(id),
    values: () => map.values(),
  };
}

describe("estimateCost", () => {
  it("returns 0 for unknown model", () => {
    expect(estimateCost("unknown-model", { input_tokens: 1000, output_tokens: 100 })).toBe(0);
  });

  it("calculates cost for claude-sonnet-4-6", () => {
    const cost = estimateCost("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    // Sonnet 4.6 input = $3/M
    expect(cost).toBeCloseTo(3, 5);
  });

  it("calculates output cost for claude-haiku-4-5-20251001", () => {
    const cost = estimateCost("claude-haiku-4-5-20251001", {
      input_tokens: 0,
      output_tokens: 1_000_000,
    });
    // Haiku output = $5/M
    expect(cost).toBeCloseTo(5, 5);
  });

  it("includes cache read and write costs", () => {
    const cost = estimateCost("claude-sonnet-4-6", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });
    // cache write = $3.75/M, cache read = $0.3/M
    expect(cost).toBeCloseTo(3.75 + 0.3, 4);
  });
});

describe("TOKEN_LIMITS", () => {
  it("has entries for all supported models", () => {
    expect(TOKEN_LIMITS["claude-sonnet-4-6"]).toBe(1_000_000);
    expect(TOKEN_LIMITS["claude-haiku-4-5-20251001"]).toBe(200_000);
  });
});

describe("UsageTracker", () => {
  it("returns null for unknown agent", () => {
    const registry = { get: () => undefined, values: () => [].values() };
    const tracker = new UsageTracker(registry, null);
    expect(tracker.getUsage("no-such-id")).toBeNull();
  });

  it("getUsage returns correct totals", () => {
    const agentProc = makeAgentProc("claude-sonnet-4-6", {
      tokensIn: 100,
      tokensOut: 50,
      estimatedCost: 0.001,
      totalTokensSpent: 150,
      totalTokensIn: 100,
      totalTokensOut: 50,
      apiTurns: 1,
      lastTurnTokensIn: 80,
    });
    const tracker = new UsageTracker(makeRegistry(agentProc), null);
    const usage = tracker.getUsage("test-id");

    expect(usage).not.toBeNull();
    expect(usage?.tokensIn).toBe(100);
    expect(usage?.tokensOut).toBe(50);
    expect(usage?.tokensTotal).toBe(150);
    expect(usage?.lastTurnTokensIn).toBe(80);
    // tokensRemaining uses lastTurnTokensIn, not cumulative
    expect(usage?.tokensRemaining).toBe(1_000_000 - 80);
    expect(usage?.model).toBe("claude-sonnet-4-6");
  });

  it("getAllUsage includes all agents", () => {
    const a1 = makeAgentProc("claude-sonnet-4-6", { tokensIn: 10, tokensOut: 5, estimatedCost: 0 });
    const a2 = makeAgentProc("claude-haiku-4-5-20251001", { tokensIn: 20, tokensOut: 10, estimatedCost: 0 });
    a1.agent.id = "a1";
    a2.agent.id = "a2";
    const registry = {
      get: (id: string) => (id === "a1" ? a1 : id === "a2" ? a2 : undefined),
      values: () => [a1, a2].values(),
    };
    const tracker = new UsageTracker(registry, null);
    const { agents } = tracker.getAllUsage();
    expect(agents).toHaveLength(2);
  });

  it("resetAllUsage zeroes all counters", () => {
    const agentProc = makeAgentProc("claude-sonnet-4-6", {
      tokensIn: 100,
      tokensOut: 50,
      estimatedCost: 5,
      totalTokensSpent: 150,
      totalTokensIn: 100,
      totalTokensOut: 50,
    });
    const tracker = new UsageTracker(makeRegistry(agentProc), null);
    tracker.resetAllUsage();
    expect(agentProc.agent.usage.tokensIn).toBe(0);
    expect(agentProc.agent.usage.estimatedCost).toBe(0);
  });

  it("upsertCostTracker does nothing when costTracker is null", () => {
    const agentProc = makeAgentProc("claude-sonnet-4-6", { tokensIn: 10 });
    const tracker = new UsageTracker(makeRegistry(agentProc), null);
    // Should not throw
    expect(() => tracker.upsertCostTracker(agentProc)).not.toThrow();
  });

  it("upsertCostTracker calls costTracker.upsert with correct values", () => {
    const agentProc = makeAgentProc("claude-sonnet-4-6", {
      tokensIn: 100,
      tokensOut: 50,
      estimatedCost: 0.002,
      totalTokensIn: 200,
      totalTokensOut: 100,
    });
    const mockCostTracker = { upsert: vi.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const tracker = new UsageTracker(makeRegistry(agentProc), mockCostTracker as any);
    tracker.upsertCostTracker(agentProc);
    expect(mockCostTracker.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "test-id",
        tokensIn: 200,
        tokensOut: 100,
        estimatedCost: 0.002,
      }),
    );
  });
});
