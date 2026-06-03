import { describe, expect, it, vi } from "vitest";
import type { WatchdogCallbacks, WatchdogRegistry } from "./agent-watchdog";
import { AgentWatchdog } from "./agent-watchdog";
import type { AgentProcess } from "./types";

function makeAgent(overrides: Partial<AgentProcess["agent"]> = {}): AgentProcess["agent"] {
  return {
    id: "test-agent-1",
    name: "test-agent",
    status: "running",
    workspaceDir: "/tmp/test",
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    model: "claude-sonnet-4-6",
    depth: 1,
    ...overrides,
  };
}

function makeProc(overrides: Partial<{ exitCode: number | null; pid: number; killed: boolean }> = {}) {
  return { exitCode: null, pid: 12345, killed: false, ...overrides } as unknown as AgentProcess["proc"];
}

function makeAgentProc(
  agentOverrides: Parameters<typeof makeAgent>[0] = {},
  procOverrides: Parameters<typeof makeProc>[0] = {},
): AgentProcess {
  return {
    agent: makeAgent(agentOverrides),
    proc: makeProc(procOverrides),
    lineBuffer: "",
    listeners: new Set(),
    seenMessageIds: new Set(),
    processingScheduled: false,
    persistBatch: "",
    persistTimer: null,
    listenerBatch: [],
    stallCount: 0,
    eventBuffer: [],
    eventBufferTotal: 0,
  };
}

function makeCallbacks(overrides: Partial<WatchdogCallbacks> = {}): WatchdogCallbacks {
  return {
    hasLifecycleLock: vi.fn().mockReturnValue(false),
    scheduleAgentUpdated: vi.fn(),
    handleEvent: vi.fn(),
    notifyIdleListeners: vi.fn(),
    ...overrides,
  };
}

function makeRegistry(entries: [string, AgentProcess][]): WatchdogRegistry {
  return {
    entries: () => entries[Symbol.iterator](),
  };
}

describe("AgentWatchdog.check", () => {
  it("skips agents with active lifecycle lock", () => {
    const ap = makeAgentProc();
    const registry = makeRegistry([["id1", ap]]);
    const callbacks = makeCallbacks({ hasLifecycleLock: vi.fn().mockReturnValue(true) });
    new AgentWatchdog(registry, callbacks).check();
    expect(callbacks.scheduleAgentUpdated).not.toHaveBeenCalled();
    expect(callbacks.handleEvent).not.toHaveBeenCalled();
  });

  it("skips paused agents", () => {
    const ap = makeAgentProc({ status: "paused" });
    const registry = makeRegistry([["id1", ap]]);
    const callbacks = makeCallbacks();
    new AgentWatchdog(registry, callbacks).check();
    expect(callbacks.scheduleAgentUpdated).not.toHaveBeenCalled();
  });

  it("skips disconnected agents", () => {
    const ap = makeAgentProc({ status: "disconnected" });
    const registry = makeRegistry([["id1", ap]]);
    const callbacks = makeCallbacks();
    new AgentWatchdog(registry, callbacks).check();
    expect(callbacks.scheduleAgentUpdated).not.toHaveBeenCalled();
  });

  describe("dead process detection", () => {
    it("marks running agent as idle when process exits cleanly (code 0)", () => {
      const ap = makeAgentProc({ status: "running" }, { exitCode: 0 });
      const registry = makeRegistry([["id1", ap]]);
      const callbacks = makeCallbacks();
      new AgentWatchdog(registry, callbacks).check();
      expect(ap.agent.status).toBe("idle");
      expect(callbacks.scheduleAgentUpdated).toHaveBeenCalledWith("id1", ap.agent, true);
      expect(callbacks.notifyIdleListeners).toHaveBeenCalledWith("id1");
    });

    it("marks running agent as error when process exits with non-zero code", () => {
      const ap = makeAgentProc({ status: "running" }, { exitCode: 1 });
      const registry = makeRegistry([["id1", ap]]);
      const callbacks = makeCallbacks();
      new AgentWatchdog(registry, callbacks).check();
      expect(ap.agent.status).toBe("error");
      expect(callbacks.notifyIdleListeners).not.toHaveBeenCalled();
    });
  });

  describe("start timeout", () => {
    it("marks starting agent as error after start timeout", () => {
      const old = new Date(Date.now() - 10 * 60_000).toISOString();
      const ap = makeAgentProc({ status: "starting", createdAt: old });
      const registry = makeRegistry([["id1", ap]]);
      const callbacks = makeCallbacks();
      new AgentWatchdog(registry, callbacks).check();
      expect(ap.agent.status).toBe("error");
      expect(callbacks.scheduleAgentUpdated).toHaveBeenCalledWith("id1", ap.agent, true);
    });

    it("does not mark starting agent as error before timeout", () => {
      const recent = new Date(Date.now() - 30_000).toISOString();
      const ap = makeAgentProc({ status: "starting", createdAt: recent });
      const registry = makeRegistry([["id1", ap]]);
      const callbacks = makeCallbacks();
      new AgentWatchdog(registry, callbacks).check();
      expect(ap.agent.status).toBe("starting");
    });
  });

  describe("stall detection", () => {
    it("marks running agent as stalled after stall timeout", () => {
      const old = new Date(Date.now() - 15 * 60_000).toISOString();
      const ap = makeAgentProc({ status: "running", lastActivity: old }, { exitCode: null });
      const registry = makeRegistry([["id1", ap]]);
      const callbacks = makeCallbacks();
      new AgentWatchdog(registry, callbacks).check();
      expect(ap.agent.status).toBe("stalled");
      expect(ap.stallCount).toBe(1);
      expect(callbacks.notifyIdleListeners).toHaveBeenCalledWith("id1");
    });

    it("escalates to error after MAX_STALL_COUNT consecutive stalls", () => {
      const old = new Date(Date.now() - 15 * 60_000).toISOString();
      const ap = makeAgentProc({ status: "running", lastActivity: old }, { exitCode: null });
      ap.stallCount = 2; // already 2, next check reaches 3
      const registry = makeRegistry([["id1", ap]]);
      const callbacks = makeCallbacks();
      new AgentWatchdog(registry, callbacks).check();
      expect(ap.agent.status).toBe("error");
    });

    it("fires soft-stall idle notification after SOFT_STALL_TIMEOUT_MS", () => {
      const old = new Date(Date.now() - 6 * 60_000).toISOString();
      const ap = makeAgentProc({ status: "running", lastActivity: old }, { exitCode: null });
      ap.softStallNotified = false;
      const registry = makeRegistry([["id1", ap]]);
      const callbacks = makeCallbacks();
      new AgentWatchdog(registry, callbacks).check();
      // soft stall: status unchanged, idle listeners notified
      expect(ap.agent.status).toBe("running");
      expect(callbacks.notifyIdleListeners).toHaveBeenCalledWith("id1");
      expect(ap.softStallNotified).toBe(true);
    });

    it("does not repeat soft-stall notification once set", () => {
      const old = new Date(Date.now() - 6 * 60_000).toISOString();
      const ap = makeAgentProc({ status: "running", lastActivity: old }, { exitCode: null });
      ap.softStallNotified = true;
      const registry = makeRegistry([["id1", ap]]);
      const callbacks = makeCallbacks();
      new AgentWatchdog(registry, callbacks).check();
      expect(callbacks.notifyIdleListeners).not.toHaveBeenCalled();
    });

    it("does not stall a recently-active agent", () => {
      const recent = new Date(Date.now() - 30_000).toISOString();
      const ap = makeAgentProc({ status: "running", lastActivity: recent }, { exitCode: null });
      const registry = makeRegistry([["id1", ap]]);
      const callbacks = makeCallbacks();
      new AgentWatchdog(registry, callbacks).check();
      expect(ap.agent.status).toBe("running");
      expect(ap.stallCount).toBe(0);
    });
  });
});
