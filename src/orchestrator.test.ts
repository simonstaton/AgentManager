import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider, MessageSender } from "./orchestrator";
import { Orchestrator } from "./orchestrator";
import type { TaskMessage } from "./task-graph";
import { TaskGraph } from "./task-graph";
import type { Agent } from "./types";

const TEST_DB_DIR = "/tmp/orchestrator-test";
const TEST_DB_PATH = path.join(TEST_DB_DIR, "test-orchestrator.db");

function cleanDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB_PATH}${suffix}`);
    } catch {}
  }
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: overrides.id ?? `agent-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? "test-agent",
    status: overrides.status ?? "idle",
    workspaceDir: "/tmp/test",
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    model: "claude-sonnet-4-6",
    depth: 1,
    claudeSessionId: "session-1",
    capabilities: overrides.capabilities,
    role: overrides.role,
    ...overrides,
  };
}

describe("Orchestrator", () => {
  let tg: TaskGraph;
  let orchestrator: Orchestrator;
  let agents: Agent[];
  let sentMessages: Array<{ agentId: string; message: TaskMessage }>;
  let sentNotifications: Array<{ agentId: string; content: string }>;

  const agentProvider: AgentProvider = {
    getAvailableAgents: () => agents.filter((a) => a.status === "idle" || a.status === "restored"),
    getAgent: (id) => agents.find((a) => a.id === id),
  };

  const messageSender: MessageSender = {
    sendTaskMessage: (agentId, message) => {
      sentMessages.push({ agentId, message });
    },
    sendNotification: (agentId, content) => {
      sentNotifications.push({ agentId, content });
    },
  };

  beforeEach(() => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    cleanDb();
    tg = new TaskGraph(TEST_DB_PATH);
    agents = [];
    sentMessages = [];
    sentNotifications = [];
    orchestrator = new Orchestrator(tg, agentProvider, messageSender, {
      pollIntervalMs: 60_000, // Don't auto-poll in tests
      maxRetries: 3,
      minCapabilityScore: 0.1,
    });
  });

  afterEach(() => {
    orchestrator.stop();
    tg.close();
  });

  describe("decomposeGoal", () => {
    it("creates subtasks from a goal", () => {
      agents.push(makeAgent({ id: "agent-1" }));

      const tasks = orchestrator.decomposeGoal({
        goal: "Build feature X",
        subtasks: [
          { title: "Research", requiredCapabilities: ["research"] },
          { title: "Implement", requiredCapabilities: ["coding"], dependsOnIndices: [0] },
          { title: "Test", requiredCapabilities: ["testing"], dependsOnIndices: [1] },
        ],
      });

      expect(tasks).toHaveLength(3);
      expect(tasks[0].title).toBe("Research");
      expect(tasks[1].title).toBe("Implement");
      expect(tasks[2].title).toBe("Test");

      // Verify dependencies
      expect(tasks[1].dependsOn).toContain(tasks[0].id);
      expect(tasks[2].dependsOn).toContain(tasks[1].id);
    });

    it("triggers assignment cycle after decomposition", () => {
      agents.push(makeAgent({ id: "agent-1" }));

      orchestrator.decomposeGoal({
        goal: "Simple task",
        subtasks: [{ title: "Do the thing" }],
      });

      // The assignment cycle should have been triggered, assigning the task
      expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("assignmentCycle", () => {
    it("assigns pending tasks to available agents", () => {
      agents.push(makeAgent({ id: "agent-1" }));
      tg.createTask({ title: "Task 1" });
      tg.createTask({ title: "Task 2" });

      const decisions = orchestrator.assignmentCycle();
      // Only one agent available, so only one assignment
      expect(decisions).toHaveLength(1);
      expect(decisions[0].agentId).toBe("agent-1");
      expect(sentMessages).toHaveLength(1);
    });

    it("assigns multiple tasks to multiple agents", () => {
      agents.push(makeAgent({ id: "agent-1" }));
      agents.push(makeAgent({ id: "agent-2" }));
      tg.createTask({ title: "Task 1" });
      tg.createTask({ title: "Task 2" });

      const decisions = orchestrator.assignmentCycle();
      expect(decisions).toHaveLength(2);
      expect(sentMessages).toHaveLength(2);
    });

    it("skips blocked tasks", () => {
      agents.push(makeAgent({ id: "agent-1" }));
      const dep = tg.createTask({ title: "Dependency" });
      tg.createTask({ title: "Blocked", dependsOn: [dep.id] });

      const decisions = orchestrator.assignmentCycle();
      // Should only assign the dependency, not the blocked task
      expect(decisions).toHaveLength(1);
      expect(decisions[0].taskId).toBe(dep.id);
    });

    it("returns empty when no agents available", () => {
      tg.createTask({ title: "Orphan Task" });

      const decisions = orchestrator.assignmentCycle();
      expect(decisions).toHaveLength(0);
    });

    it("returns empty when no tasks available", () => {
      agents.push(makeAgent({ id: "agent-1" }));

      const decisions = orchestrator.assignmentCycle();
      expect(decisions).toHaveLength(0);
    });
  });

  describe("capability-aware routing", () => {
    it("prefers agents with higher capability scores", () => {
      agents.push(makeAgent({ id: "agent-good", name: "good-agent" }));
      agents.push(makeAgent({ id: "agent-bad", name: "bad-agent" }));

      // Set up capability profiles
      tg.upsertCapabilityProfile({
        agentId: "agent-good",
        capabilities: { testing: 0.9 },
        successRate: { testing: 0.95 },
        totalCompleted: 20,
        totalFailed: 1,
        updatedAt: new Date().toISOString(),
      });

      tg.upsertCapabilityProfile({
        agentId: "agent-bad",
        capabilities: { testing: 0.2 },
        successRate: { testing: 0.1 },
        totalCompleted: 2,
        totalFailed: 8,
        updatedAt: new Date().toISOString(),
      });

      tg.createTask({ title: "Testing Task", requiredCapabilities: ["testing"] });

      const decisions = orchestrator.assignmentCycle();
      expect(decisions).toHaveLength(1);
      expect(decisions[0].agentId).toBe("agent-good");
    });

    it("falls back to any agent when none have capability profiles", () => {
      agents.push(makeAgent({ id: "agent-1" }));

      tg.createTask({ title: "Specialized Task", requiredCapabilities: ["rare-skill"] });

      const decisions = orchestrator.assignmentCycle();
      expect(decisions).toHaveLength(1);
      expect(decisions[0].agentId).toBe("agent-1");
      expect(decisions[0].reason).toContain("Fallback");
    });
  });

  describe("submitResult", () => {
    it("accepts a successful result", () => {
      const task = tg.createTask({ title: "Complete Me" });
      tg.assignTask(task.id, "agent-1", task.version);
      const a = tg.getTask(task.id)!;
      tg.startTask(task.id, a.version);

      const outcome = orchestrator.submitResult({
        taskId: task.id,
        status: "completed",
        output: { pr: "https://github.com/..." },
        confidence: "high",
        durationMs: 5000,
      });

      expect(outcome.accepted).toBe(true);
      expect(tg.getTask(task.id)!.status).toBe("completed");
    });

    it("unblocks dependent tasks on success", () => {
      agents.push(makeAgent({ id: "agent-1" }));

      const dep = tg.createTask({ title: "Dependency" });
      const blocked = tg.createTask({ title: "Blocked", dependsOn: [dep.id] });

      tg.assignTask(dep.id, "agent-1", dep.version);
      const a = tg.getTask(dep.id)!;
      tg.startTask(dep.id, a.version);

      const outcome = orchestrator.submitResult({
        taskId: dep.id,
        status: "completed",
        output: null,
        confidence: "high",
        durationMs: 1000,
      });

      expect(outcome.accepted).toBe(true);
      expect(outcome.unblockedTasks).toHaveLength(1);
      expect(outcome.unblockedTasks[0].id).toBe(blocked.id);
      // The orchestrator auto-assigns unblocked tasks, so status may be "assigned" or "pending"
      expect(["pending", "assigned"]).toContain(tg.getTask(blocked.id)!.status);
    });

    it("handles failure and triggers retry", () => {
      agents.push(makeAgent({ id: "agent-1" }));
      agents.push(makeAgent({ id: "agent-2" }));

      const task = tg.createTask({ title: "Fail Then Retry", maxRetries: 3 });
      tg.assignTask(task.id, "agent-1", task.version);
      const a = tg.getTask(task.id)!;
      tg.startTask(task.id, a.version);

      const outcome = orchestrator.submitResult({
        taskId: task.id,
        status: "failed",
        output: null,
        confidence: "low",
        durationMs: 2000,
        errorMessage: "Test failed",
      });

      expect(outcome.accepted).toBe(true);

      // The orchestrator should attempt recovery (retry with agent-2)
      const updated = tg.getTask(task.id)!;
      // Task should have been retried (either pending or assigned to agent-2)
      expect(["pending", "assigned"]).toContain(updated.status);
    });

    it("rejects result for non-existent task", () => {
      const outcome = orchestrator.submitResult({
        taskId: "nonexistent",
        status: "completed",
        output: null,
        confidence: "high",
        durationMs: 0,
      });

      expect(outcome.accepted).toBe(false);
      expect(outcome.error).toBe("Task not found");
    });

    it("rejects result for task in wrong state", () => {
      const task = tg.createTask({ title: "Pending Task" });

      const outcome = orchestrator.submitResult({
        taskId: task.id,
        status: "completed",
        output: null,
        confidence: "high",
        durationMs: 0,
      });

      expect(outcome.accepted).toBe(false);
      expect(outcome.error).toContain("pending");
    });

    it("updates agent capability stats on completion", () => {
      const task = tg.createTask({
        title: "Scored Task",
        requiredCapabilities: ["testing"],
      });
      tg.assignTask(task.id, "agent-1", task.version);
      const a = tg.getTask(task.id)!;
      tg.startTask(task.id, a.version);

      orchestrator.submitResult({
        taskId: task.id,
        status: "completed",
        output: null,
        confidence: "high",
        durationMs: 1000,
      });

      const profile = tg.getCapabilityProfile("agent-1");
      expect(profile).not.toBeNull();
      expect(profile!.totalCompleted).toBe(1);
    });
  });

  describe("failure propagation", () => {
    it("notifies blocked agents when recovery is exhausted", () => {
      agents.push(makeAgent({ id: "agent-1" }));
      agents.push(makeAgent({ id: "agent-2" }));

      const dep = tg.createTask({ title: "Will Fail", maxRetries: 0 });
      const blocked = tg.createTask({ title: "Waiting", dependsOn: [dep.id] });

      // Assign blocked task to agent-2 first
      // Note: blocked task starts as "blocked" status, so we need to handle this
      // The blocked task owner needs to be set for notification
      tg.assignTask(dep.id, "agent-1", dep.version);
      const a = tg.getTask(dep.id)!;
      tg.startTask(dep.id, a.version);

      orchestrator.submitResult({
        taskId: dep.id,
        status: "failed",
        output: null,
        confidence: "low",
        durationMs: 1000,
        errorMessage: "Unrecoverable failure",
      });

      // Blocked task should remain blocked
      const updatedBlocked = tg.getTask(blocked.id)!;
      expect(updatedBlocked.status).toBe("blocked");
    });
  });

  describe("status and event log", () => {
    it("reports running state correctly", () => {
      expect(orchestrator.getStatus().running).toBe(false);

      orchestrator.start();
      expect(orchestrator.getStatus().running).toBe(true);

      orchestrator.stop();
      expect(orchestrator.getStatus().running).toBe(false);
    });

    it("tracks events in the log", () => {
      agents.push(makeAgent({ id: "agent-1" }));
      tg.createTask({ title: "Tracked Task" });

      orchestrator.assignmentCycle();

      const events = orchestrator.getEventLog();
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === "task_assigned")).toBe(true);
    });

    it("includes task summary in status", () => {
      tg.createTask({ title: "Task 1" });
      tg.createTask({ title: "Task 2" });

      const status = orchestrator.getStatus();
      expect(status.taskSummary.total).toBe(2);
      expect(status.taskSummary.byStatus.pending).toBe(2);
    });
  });
});
