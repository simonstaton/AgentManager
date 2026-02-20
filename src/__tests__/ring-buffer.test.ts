import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProcess, StreamEvent } from "../types";

/**
 * Tests for the in-memory ring buffer and hybrid readPersistedEvents in AgentManager.
 * Validates ring buffer wrap-around ordering and cold-to-hot buffer population.
 */

// Suppress persistence side-effects during tests
vi.mock("../persistence", () => ({
  EVENTS_DIR: "/tmp/test-ring-buffer-events",
  loadAllAgentStates: () => [],
  saveAgentState: vi.fn(),
  removeAgentState: vi.fn(),
  writeTombstone: vi.fn(),
}));
vi.mock("../storage", () => ({
  cleanupAgentClaudeData: vi.fn(),
  debouncedSyncToGCS: vi.fn(),
}));
vi.mock("../worktrees", () => ({
  cleanupWorktreesForWorkspace: vi.fn(),
}));

const EVENTS_DIR = "/tmp/test-ring-buffer-events";
const TEST_AGENT_ID = "test-ring-buffer-agent";

/** Helper to create a minimal AgentProcess with ring buffer fields. */
function makeAgentProc(overrides?: Partial<AgentProcess>): AgentProcess {
  return {
    agent: {
      id: TEST_AGENT_ID,
      name: "test-agent",
      status: "running",
      workspaceDir: "/tmp/test-ring-workspace",
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
    ...overrides,
  };
}

/** Helper to create a simple StreamEvent. */
function makeEvent(n: number): StreamEvent {
  return { type: "raw", text: `event-${n}` };
}

describe("ring buffer", () => {
  let AgentManager: typeof import("../agents").AgentManager;
  let manager: InstanceType<typeof AgentManager>;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret-ring-buffer";
    process.env.SHARED_CONTEXT_DIR = "/tmp/test-ring-buffer-context";
    mkdirSync(EVENTS_DIR, { recursive: true });
  });

  beforeEach(async () => {
    mkdirSync(EVENTS_DIR, { recursive: true });
    const mod = await import("../agents");
    AgentManager = mod.AgentManager;
    manager = new AgentManager();
  });

  afterEach(() => {
    manager.dispose();
    rmSync(EVENTS_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.env.SHARED_CONTEXT_DIR = undefined;
  });

  /** Inject a fake agent into the manager's private agents map. */
  function injectAgent(agentProc: AgentProcess): void {
    const agents = (manager as unknown as { agents: Map<string, AgentProcess> }).agents;
    agents.set(agentProc.agent.id, agentProc);
  }

  /** Call the private readEventBuffer method. */
  function readEventBuffer(agentProc: AgentProcess): StreamEvent[] {
    return (manager as unknown as { readEventBuffer: (ap: AgentProcess) => StreamEvent[] }).readEventBuffer(agentProc);
  }

  describe("readEventBuffer", () => {
    it("returns empty array for empty buffer", () => {
      const proc = makeAgentProc();
      injectAgent(proc);
      expect(readEventBuffer(proc)).toEqual([]);
    });

    it("returns events in order when buffer has not wrapped", () => {
      const proc = makeAgentProc();
      // Simulate 5 events pushed (no wrapping with 1000-size buffer)
      for (let i = 0; i < 5; i++) {
        proc.eventBuffer.push(makeEvent(i));
      }
      proc.eventBufferTotal = 5;
      injectAgent(proc);

      const result = readEventBuffer(proc);
      expect(result).toHaveLength(5);
      expect(result[0]).toEqual(makeEvent(0));
      expect(result[4]).toEqual(makeEvent(4));
    });

    it("returns events in insertion order after wrap-around", () => {
      // Use a small buffer size to test wrapping. The actual buffer size is 1000,
      // so we manually construct a wrapped state to verify the read logic.
      const BUFFER_SIZE = 4;
      const proc = makeAgentProc();

      // Simulate writing 7 events into a buffer of size 4:
      // Events 0-3 fill the buffer, then 4-6 overwrite positions 0-2.
      // Buffer state: [E4, E5, E6, E3]
      // eventBufferTotal = 7
      // Oldest is at index 7 % 4 = 3 (E3), order should be: E3, E4, E5, E6
      proc.eventBuffer = [makeEvent(4), makeEvent(5), makeEvent(6), makeEvent(3)];
      proc.eventBufferTotal = 7;
      injectAgent(proc);

      // readEventBuffer checks eventBufferTotal > RING_BUFFER_SIZE (1000).
      // Since our total is 7 < 1000, it will take the non-wrapped path.
      // To test the wrap path, we need eventBufferTotal > 1000.
      // Set total high enough to trigger the wrap-around code path.
      proc.eventBufferTotal = 1003; // > 1000, triggers wrap logic
      // With 4 items and total=1003: start = 1003 % 4 = 3
      // Result: [buffer[3], buffer[0], buffer[1], buffer[2]] = [E3, E4, E5, E6]

      const result = readEventBuffer(proc);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual(makeEvent(3));
      expect(result[1]).toEqual(makeEvent(4));
      expect(result[2]).toEqual(makeEvent(5));
      expect(result[3]).toEqual(makeEvent(6));
    });

    it("returns a copy, not a reference to the original buffer", () => {
      const proc = makeAgentProc();
      proc.eventBuffer = [makeEvent(0), makeEvent(1)];
      proc.eventBufferTotal = 2;
      injectAgent(proc);

      const result = readEventBuffer(proc);
      result.push(makeEvent(99));
      expect(proc.eventBuffer).toHaveLength(2);
    });
  });

  describe("getEvents (hot path — ring buffer)", () => {
    it("returns events from ring buffer when agent has events in memory", async () => {
      const proc = makeAgentProc();
      for (let i = 0; i < 3; i++) {
        proc.eventBuffer.push(makeEvent(i));
      }
      proc.eventBufferTotal = 3;
      injectAgent(proc);

      const events = await manager.getEvents(TEST_AGENT_ID);
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual(makeEvent(0));
      expect(events[2]).toEqual(makeEvent(2));
    });

    it("returns empty array for unknown agent", async () => {
      const events = await manager.getEvents("nonexistent");
      expect(events).toEqual([]);
    });
  });

  describe("getEvents (cold path — disk streaming)", () => {
    it("reads events from .jsonl file when ring buffer is empty", async () => {
      const proc = makeAgentProc();
      // Ring buffer is empty (eventBufferTotal = 0) — forces cold path
      injectAgent(proc);

      // Write a .jsonl file for this agent
      const filePath = path.join(EVENTS_DIR, `${TEST_AGENT_ID}.jsonl`);
      const lines = [JSON.stringify(makeEvent(0)), JSON.stringify(makeEvent(1)), JSON.stringify(makeEvent(2))].join(
        "\n",
      );
      writeFileSync(filePath, `${lines}\n`);

      const events = await manager.getEvents(TEST_AGENT_ID);
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual(makeEvent(0));
      expect(events[2]).toEqual(makeEvent(2));
    });

    it("populates ring buffer after cold read for subsequent hot reads", async () => {
      const proc = makeAgentProc();
      injectAgent(proc);

      const filePath = path.join(EVENTS_DIR, `${TEST_AGENT_ID}.jsonl`);
      const lines = Array.from({ length: 5 }, (_, i) => JSON.stringify(makeEvent(i))).join("\n");
      writeFileSync(filePath, `${lines}\n`);

      // First call: cold path (disk)
      const coldEvents = await manager.getEvents(TEST_AGENT_ID);
      expect(coldEvents).toHaveLength(5);

      // Ring buffer should now be populated
      expect(proc.eventBuffer.length).toBeGreaterThan(0);
      expect(proc.eventBufferTotal).toBe(5);

      // Second call: hot path (ring buffer, no disk read)
      const hotEvents = await manager.getEvents(TEST_AGENT_ID);
      expect(hotEvents).toHaveLength(5);
      expect(hotEvents).toEqual(coldEvents);
    });

    it("skips malformed JSON lines gracefully", async () => {
      const proc = makeAgentProc();
      injectAgent(proc);

      const filePath = path.join(EVENTS_DIR, `${TEST_AGENT_ID}.jsonl`);
      const content = [
        JSON.stringify(makeEvent(0)),
        "not-valid-json{{{",
        JSON.stringify(makeEvent(1)),
        "",
        JSON.stringify(makeEvent(2)),
      ].join("\n");
      writeFileSync(filePath, `${content}\n`);

      const events = await manager.getEvents(TEST_AGENT_ID);
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual(makeEvent(0));
      expect(events[1]).toEqual(makeEvent(1));
      expect(events[2]).toEqual(makeEvent(2));
    });

    it("returns empty array when .jsonl file does not exist", async () => {
      const proc = makeAgentProc();
      injectAgent(proc);
      // No file written — cold path should return []
      const events = await manager.getEvents(TEST_AGENT_ID);
      expect(events).toEqual([]);
    });
  });
});
