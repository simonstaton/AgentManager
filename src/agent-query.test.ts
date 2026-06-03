import { describe, expect, it, vi } from "vitest";
import type { QueryRegistry } from "./agent-query";
import { AgentQueryService, getGitInfo } from "./agent-query";
import type { EventPipeline } from "./event-pipeline";
import type { AgentProcess } from "./types";
import type { UsageTracker } from "./usage-tracker";

vi.mock("node:child_process", async (orig) => {
  const actual = await orig<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn((_cmd: unknown, _args: unknown, _opts: unknown, cb: (e: Error) => void) => {
      cb(new Error("no git"));
    }),
  };
});

function makeReg(has = true): QueryRegistry {
  const ap: AgentProcess = {
    agent: {
      id: "a1",
      name: "t",
      status: "idle",
      workspaceDir: "/tmp/t",
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      model: "claude-sonnet-4-6",
      depth: 1,
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
  return {
    get: vi.fn().mockReturnValue(has ? ap : undefined),
    has: vi.fn().mockReturnValue(has),
    entries: vi.fn().mockReturnValue([][Symbol.iterator]()),
    values: vi.fn().mockReturnValue([][Symbol.iterator]()),
    keys: vi.fn().mockReturnValue([][Symbol.iterator]()),
    size: 0,
  } as unknown as QueryRegistry;
}

const makeTracker = () =>
  ({
    getUsage: vi.fn().mockReturnValue(null),
    getAllUsage: vi.fn().mockReturnValue({ agents: [] }),
    resetAllUsage: vi.fn(),
    upsertCostTracker: vi.fn(),
  }) as unknown as UsageTracker;
const makePipeline = () =>
  ({ readPersistedEvents: vi.fn().mockResolvedValue({ events: [] }) }) as unknown as EventPipeline;

describe("getGitInfo", () => {
  it("returns nulls when workspace does not exist", async () => {
    const info = await getGitInfo("/nonexistent/path/xyz");
    expect(info.repo).toBeNull();
    expect(info.branch).toBeNull();
    expect(info.worktreePath).toBeNull();
  });
});

describe("AgentQueryService", () => {
  it("getEvents returns empty array for unknown agent", async () => {
    const svc = new AgentQueryService(makeReg(false), makeTracker(), makePipeline());
    expect(await svc.getEvents("missing")).toEqual([]);
  });

  it("getUsage delegates to usageTracker", () => {
    const tracker = makeTracker();
    new AgentQueryService(makeReg(), tracker, makePipeline()).getUsage("a1");
    expect(tracker.getUsage).toHaveBeenCalledWith("a1");
  });

  it("getAllUsage delegates to usageTracker", () => {
    const tracker = makeTracker();
    new AgentQueryService(makeReg(), tracker, makePipeline()).getAllUsage();
    expect(tracker.getAllUsage).toHaveBeenCalled();
  });

  it("getLogs returns empty when no events", async () => {
    const svc = new AgentQueryService(makeReg(), makeTracker(), makePipeline());
    const result = await svc.getLogs("a1");
    expect(result.total).toBe(0);
  });
});
