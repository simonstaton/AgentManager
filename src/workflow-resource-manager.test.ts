import { describe, expect, it, vi } from "vitest";
import type { AgentManager } from "./agents";
import {
  checkWorkflowAgentLimit,
  computeWorkflowActualCost,
  detectWorkflowStall,
  enforceWorkflowCostCap,
  WORKFLOW_COST_CAP_MULTIPLIER,
} from "./workflow-resource-manager";

vi.mock("./utils/memory", () => ({
  getContainerMemoryUsage: vi.fn(() => 0.5 * 1024 * 1024 * 1024),
  getContainerMemoryLimit: vi.fn(() => 2 * 1024 * 1024 * 1024),
}));

vi.mock("./config", () => ({ CONFIG: { MEMORY_REJECT_THRESHOLD: 0.9 } }));
vi.mock("./logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

function makeAgentManager(
  agents: Record<string, { usage?: { estimatedCost: number }; status: string; lastActivity: string }>,
) {
  return { get: (id: string) => agents[id] };
}

describe("checkWorkflowAgentLimit", () => {
  it("returns null when under limit", () => {
    expect(checkWorkflowAgentLimit(5, 10)).toBeNull();
  });

  it("returns error when at limit", () => {
    expect(checkWorkflowAgentLimit(10, 10)).toContain("10/10");
  });
});

describe("computeWorkflowActualCost", () => {
  it("sums estimatedCost across agents", () => {
    const am = makeAgentManager({
      a1: { usage: { estimatedCost: 1.5 }, status: "idle", lastActivity: new Date().toISOString() },
      a2: { usage: { estimatedCost: 0.5 }, status: "idle", lastActivity: new Date().toISOString() },
    });
    expect(computeWorkflowActualCost(["a1", "a2"], am as unknown as AgentManager)).toBe(2);
  });

  it("treats missing agents as 0 cost", () => {
    const am = makeAgentManager({});
    expect(computeWorkflowActualCost(["missing"], am as unknown as AgentManager)).toBe(0);
  });
});

describe("enforceWorkflowCostCap", () => {
  it("calls onCap when actual >= cap", () => {
    const onCap = vi.fn();
    const am = makeAgentManager({
      a1: { usage: { estimatedCost: 5 }, status: "idle", lastActivity: new Date().toISOString() },
    });
    enforceWorkflowCostCap("wf1", ["a1"], 2, am as unknown as AgentManager, onCap);
    expect(onCap).toHaveBeenCalledWith("wf1", 5, 2 * WORKFLOW_COST_CAP_MULTIPLIER);
  });

  it("does not call onCap when under cap", () => {
    const onCap = vi.fn();
    const am = makeAgentManager({
      a1: { usage: { estimatedCost: 1 }, status: "idle", lastActivity: new Date().toISOString() },
    });
    enforceWorkflowCostCap("wf1", ["a1"], 10, am as unknown as AgentManager, onCap);
    expect(onCap).not.toHaveBeenCalled();
  });

  it("no-op when costEstimate is 0", () => {
    const onCap = vi.fn();
    const am = makeAgentManager({
      a1: { usage: { estimatedCost: 999 }, status: "idle", lastActivity: new Date().toISOString() },
    });
    enforceWorkflowCostCap("wf1", ["a1"], 0, am as unknown as AgentManager, onCap);
    expect(onCap).not.toHaveBeenCalled();
  });
});

describe("detectWorkflowStall", () => {
  it("returns false for empty agent list", () => {
    const am = makeAgentManager({});
    expect(detectWorkflowStall("wf1", [], am as unknown as AgentManager, vi.fn())).toBe(false);
  });

  it("returns false when agent is running", () => {
    const am = makeAgentManager({
      a1: { status: "running", lastActivity: new Date(Date.now() - 99999999).toISOString() },
    });
    expect(detectWorkflowStall("wf1", ["a1"], am as unknown as AgentManager, vi.fn())).toBe(false);
  });
});
