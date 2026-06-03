import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EphemeralCleanup, isAgentRetainedAt } from "./ephemeral-cleanup";
import type { AgentProcess } from "./types";

vi.useFakeTimers();

function makeAgentProc(ephemeral: boolean, retainUntil?: string): AgentProcess {
  return {
    agent: {
      id: "ep-agent",
      name: "ep",
      status: "idle",
      workspaceDir: "/tmp/test",
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      model: "claude-sonnet-4-6",
      depth: 1,
      ephemeral,
      retainUntil,
    },
    proc: null,
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

describe("isAgentRetainedAt", () => {
  it("returns false when retainUntil is not set", () => {
    const agent = makeAgentProc(true).agent;
    expect(isAgentRetainedAt(agent, Date.now())).toBe(false);
  });

  it("returns true when retainUntil is in the future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const agent = makeAgentProc(true, future).agent;
    expect(isAgentRetainedAt(agent, Date.now())).toBe(true);
  });

  it("returns false when retainUntil is in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const agent = makeAgentProc(true, past).agent;
    expect(isAgentRetainedAt(agent, Date.now())).toBe(false);
  });
});

describe("EphemeralCleanup", () => {
  let destroyedIds: string[];
  let agents: Map<string, AgentProcess>;
  let cleanup: EphemeralCleanup;

  beforeEach(() => {
    destroyedIds = [];
    agents = new Map();
    cleanup = new EphemeralCleanup(agents, { destroy: (id) => destroyedIds.push(id) });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("does nothing for non-ephemeral agent", () => {
    const ap = makeAgentProc(false);
    agents.set("id1", ap);
    cleanup.schedule("id1");
    vi.advanceTimersByTime(120_000);
    expect(destroyedIds).toHaveLength(0);
  });

  it("does nothing if agent not found", () => {
    cleanup.schedule("missing");
    vi.advanceTimersByTime(120_000);
    expect(destroyedIds).toHaveLength(0);
  });

  it("auto-destroys ephemeral agent after grace period", () => {
    const ap = makeAgentProc(true);
    agents.set("id1", ap);
    cleanup.schedule("id1");
    vi.advanceTimersByTime(60_000);
    expect(destroyedIds).toContain("id1");
  });

  it("does not destroy if agent is not idle when timer fires", () => {
    const ap = makeAgentProc(true);
    agents.set("id1", ap);
    cleanup.schedule("id1");
    ap.agent.status = "running"; // agent restarted before timer fires
    vi.advanceTimersByTime(60_000);
    expect(destroyedIds).toHaveLength(0);
  });

  it("cancel prevents auto-destroy", () => {
    const ap = makeAgentProc(true);
    agents.set("id1", ap);
    cleanup.schedule("id1");
    cleanup.cancel("id1");
    vi.advanceTimersByTime(60_000);
    expect(destroyedIds).toHaveLength(0);
  });

  it("does not destroy if agent was already removed", () => {
    const ap = makeAgentProc(true);
    agents.set("id1", ap);
    cleanup.schedule("id1");
    agents.delete("id1"); // destroyed by other code before timer fires
    vi.advanceTimersByTime(60_000);
    expect(destroyedIds).toHaveLength(0);
  });
});
