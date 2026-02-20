import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskGraphEvent, TaskNode } from "./task-graph";
import { TaskGraph } from "./task-graph";

const TEST_DB_DIR = "/tmp/task-graph-test";
const TEST_DB_PATH = path.join(TEST_DB_DIR, "test-task-graph.db");

function cleanDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB_PATH}${suffix}`);
    } catch {}
  }
}

describe("TaskGraph", () => {
  let tg: TaskGraph;

  beforeEach(() => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    cleanDb();
    tg = new TaskGraph(TEST_DB_PATH);
  });

  afterEach(() => {
    tg.close();
  });

  describe("createTask", () => {
    it("creates a task with defaults", () => {
      const task = tg.createTask({ title: "Test Task" });
      expect(task.id).toBeTruthy();
      expect(task.title).toBe("Test Task");
      expect(task.status).toBe("pending");
      expect(task.priority).toBe(3);
      expect(task.version).toBe(1);
      expect(task.retryCount).toBe(0);
      expect(task.maxRetries).toBe(3);
      expect(task.ownerAgentId).toBeNull();
      expect(task.dependsOn).toEqual([]);
    });

    it("creates a task with all options", () => {
      const task = tg.createTask({
        title: "Full Task",
        description: "A detailed task",
        priority: 1,
        ownerAgentId: "agent-1",
        input: { repo: "example" },
        expectedOutput: { type: "pr_url" },
        acceptanceCriteria: "Tests pass",
        requiredCapabilities: ["code-review", "testing"],
        maxRetries: 5,
        timeoutMs: 60_000,
      });

      expect(task.title).toBe("Full Task");
      expect(task.description).toBe("A detailed task");
      expect(task.priority).toBe(1);
      expect(task.input).toEqual({ repo: "example" });
      expect(task.expectedOutput).toEqual({ type: "pr_url" });
      expect(task.acceptanceCriteria).toBe("Tests pass");
      expect(task.requiredCapabilities).toEqual(["code-review", "testing"]);
      expect(task.maxRetries).toBe(5);
      expect(task.timeoutMs).toBe(60_000);
    });

    it("emits task_created event", () => {
      const events: TaskGraphEvent[] = [];
      tg.subscribe((e) => events.push(e));

      tg.createTask({ title: "Emitting Task" });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("task_created");
    });
  });

  describe("getTask", () => {
    it("returns null for non-existent task", () => {
      expect(tg.getTask("nonexistent")).toBeNull();
    });

    it("returns task with resolved dependencies", () => {
      const dep = tg.createTask({ title: "Dependency" });
      const task = tg.createTask({ title: "Dependent", dependsOn: [dep.id] });

      const retrieved = tg.getTask(task.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.dependsOn).toEqual([dep.id]);
    });
  });

  describe("queryTasks", () => {
    it("returns all tasks when no filters", () => {
      tg.createTask({ title: "Task 1" });
      tg.createTask({ title: "Task 2" });
      tg.createTask({ title: "Task 3" });

      const tasks = tg.queryTasks();
      expect(tasks).toHaveLength(3);
    });

    it("filters by status", () => {
      const t1 = tg.createTask({ title: "Pending" });
      tg.createTask({ title: "Also Pending" });
      tg.assignTask(t1.id, "agent-1", t1.version);

      const pending = tg.queryTasks({ status: "pending" });
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe("Also Pending");

      const assigned = tg.queryTasks({ status: "assigned" });
      expect(assigned).toHaveLength(1);
      expect(assigned[0].title).toBe("Pending");
    });

    it("filters by multiple statuses", () => {
      const t1 = tg.createTask({ title: "Pending" });
      tg.createTask({ title: "Also Pending" });
      tg.assignTask(t1.id, "agent-1", t1.version);

      const both = tg.queryTasks({ status: ["pending", "assigned"] });
      expect(both).toHaveLength(2);
    });

    it("filters by owner", () => {
      const t1 = tg.createTask({ title: "Owned" });
      tg.createTask({ title: "Unowned" });
      tg.assignTask(t1.id, "agent-1", t1.version);

      const owned = tg.queryTasks({ ownerAgentId: "agent-1" });
      expect(owned).toHaveLength(1);
      expect(owned[0].title).toBe("Owned");
    });

    it("filters unowned tasks", () => {
      const t1 = tg.createTask({ title: "Owned" });
      tg.createTask({ title: "Unowned" });
      tg.assignTask(t1.id, "agent-1", t1.version);

      const unowned = tg.queryTasks({ unowned: true });
      expect(unowned).toHaveLength(1);
      expect(unowned[0].title).toBe("Unowned");
    });

    it("filters unblocked tasks (post-filter)", () => {
      const dep = tg.createTask({ title: "Dependency" });
      tg.createTask({ title: "Blocked", dependsOn: [dep.id] });
      tg.createTask({ title: "Free" });

      const unblocked = tg.queryTasks({ unblocked: true });
      // "Dependency" and "Free" are unblocked; "Blocked" has an incomplete dep
      expect(unblocked.map((t) => t.title).sort()).toEqual(["Dependency", "Free"]);
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        tg.createTask({ title: `Task ${i}` });
      }

      const limited = tg.queryTasks({ limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  describe("deleteTask", () => {
    it("deletes an existing task", () => {
      const task = tg.createTask({ title: "Delete Me" });
      expect(tg.deleteTask(task.id)).toBe(true);
      expect(tg.getTask(task.id)).toBeNull();
    });

    it("returns false for non-existent task", () => {
      expect(tg.deleteTask("nonexistent")).toBe(false);
    });
  });

  describe("clearAll", () => {
    it("removes all tasks", () => {
      tg.createTask({ title: "Task 1" });
      tg.createTask({ title: "Task 2" });

      const count = tg.clearAll();
      expect(count).toBe(2);
      expect(tg.queryTasks()).toHaveLength(0);
    });
  });

  describe("assignTask", () => {
    it("assigns a pending task", () => {
      const task = tg.createTask({ title: "Assign Me" });
      const result = tg.assignTask(task.id, "agent-1", task.version);
      expect(result).toBe(true);

      const updated = tg.getTask(task.id);
      expect(updated!.status).toBe("assigned");
      expect(updated!.ownerAgentId).toBe("agent-1");
      expect(updated!.version).toBe(task.version + 1);
    });

    it("fails with wrong version (optimistic lock)", () => {
      const task = tg.createTask({ title: "Lock Test" });
      const result = tg.assignTask(task.id, "agent-1", task.version + 999);
      expect(result).toBe(false);
    });

    it("emits task_assigned event", () => {
      const events: TaskGraphEvent[] = [];
      tg.subscribe((e) => events.push(e));

      const task = tg.createTask({ title: "Event Test" });
      tg.assignTask(task.id, "agent-1", task.version);

      const assignEvent = events.find((e) => e.type === "task_assigned");
      expect(assignEvent).toBeDefined();
    });
  });

  describe("startTask", () => {
    it("transitions from assigned to running", () => {
      const task = tg.createTask({ title: "Start Me" });
      tg.assignTask(task.id, "agent-1", task.version);

      const assigned = tg.getTask(task.id)!;
      const result = tg.startTask(task.id, assigned.version);
      expect(result).toBe(true);

      const running = tg.getTask(task.id)!;
      expect(running.status).toBe("running");
    });
  });

  describe("completeTask", () => {
    it("completes a task and sets completedAt", () => {
      const task = tg.createTask({ title: "Complete Me" });
      tg.assignTask(task.id, "agent-1", task.version);
      const assigned = tg.getTask(task.id)!;
      tg.startTask(task.id, assigned.version);
      const running = tg.getTask(task.id)!;

      const { success } = tg.completeTask(task.id, running.version);
      expect(success).toBe(true);

      const completed = tg.getTask(task.id)!;
      expect(completed.status).toBe("completed");
      expect(completed.completedAt).not.toBeNull();
    });

    it("unblocks dependent tasks when completed", () => {
      const dep = tg.createTask({ title: "Dependency" });
      const blocked = tg.createTask({ title: "Blocked", dependsOn: [dep.id] });

      expect(tg.getTask(blocked.id)!.status).toBe("blocked");

      // Complete the dependency
      tg.assignTask(dep.id, "agent-1", dep.version);
      const assigned = tg.getTask(dep.id)!;
      tg.startTask(dep.id, assigned.version);
      const running = tg.getTask(dep.id)!;
      const { success, unblockedTasks } = tg.completeTask(dep.id, running.version);

      expect(success).toBe(true);
      expect(unblockedTasks).toHaveLength(1);
      expect(unblockedTasks[0].id).toBe(blocked.id);
      expect(tg.getTask(blocked.id)!.status).toBe("pending");
    });

    it("does not unblock if other dependencies remain incomplete", () => {
      const dep1 = tg.createTask({ title: "Dep 1" });
      const dep2 = tg.createTask({ title: "Dep 2" });
      const blocked = tg.createTask({ title: "Blocked", dependsOn: [dep1.id, dep2.id] });

      expect(tg.getTask(blocked.id)!.status).toBe("blocked");

      // Complete only dep1
      tg.assignTask(dep1.id, "agent-1", dep1.version);
      const assigned = tg.getTask(dep1.id)!;
      tg.startTask(dep1.id, assigned.version);
      const running = tg.getTask(dep1.id)!;
      const { unblockedTasks } = tg.completeTask(dep1.id, running.version);

      expect(unblockedTasks).toHaveLength(0);
      expect(tg.getTask(blocked.id)!.status).toBe("blocked");
    });
  });

  describe("failTask", () => {
    it("fails a task with an error message", () => {
      const task = tg.createTask({ title: "Fail Me" });
      tg.assignTask(task.id, "agent-1", task.version);
      const assigned = tg.getTask(task.id)!;
      tg.startTask(task.id, assigned.version);
      const running = tg.getTask(task.id)!;

      const { success, canRetry } = tg.failTask(task.id, running.version, "Something broke");
      expect(success).toBe(true);
      expect(canRetry).toBe(true);

      const failed = tg.getTask(task.id)!;
      expect(failed.status).toBe("failed");
      expect(failed.errorMessage).toBe("Something broke");
      expect(failed.retryCount).toBe(1);
    });

    it("blocks dependent tasks on failure", () => {
      const dep = tg.createTask({ title: "Will Fail" });
      const dependent = tg.createTask({ title: "Blocked", dependsOn: [dep.id] });

      tg.assignTask(dep.id, "agent-1", dep.version);
      const assigned = tg.getTask(dep.id)!;
      tg.startTask(dep.id, assigned.version);
      const running = tg.getTask(dep.id)!;

      const { blockedTasks } = tg.failTask(dep.id, running.version, "Failed");
      expect(blockedTasks).toHaveLength(1);
      expect(blockedTasks[0].id).toBe(dependent.id);
    });

    it("reports canRetry false when retries exhausted", () => {
      const task = tg.createTask({ title: "No Retries", maxRetries: 1 });
      tg.assignTask(task.id, "agent-1", task.version);
      const a1 = tg.getTask(task.id)!;
      tg.startTask(task.id, a1.version);
      const r1 = tg.getTask(task.id)!;

      // First failure (retryCount becomes 1, maxRetries is 1)
      const { canRetry } = tg.failTask(r1.id, r1.version, "Failed once");
      expect(canRetry).toBe(false);
    });
  });

  describe("cancelTask", () => {
    it("cancels a pending task", () => {
      const task = tg.createTask({ title: "Cancel Me" });
      const result = tg.cancelTask(task.id, task.version);
      expect(result).toBe(true);

      const cancelled = tg.getTask(task.id)!;
      expect(cancelled.status).toBe("cancelled");
    });

    it("cannot cancel a completed task", () => {
      const task = tg.createTask({ title: "Done" });
      tg.assignTask(task.id, "agent-1", task.version);
      const a = tg.getTask(task.id)!;
      tg.startTask(task.id, a.version);
      const r = tg.getTask(task.id)!;
      tg.completeTask(task.id, r.version);
      const c = tg.getTask(task.id)!;

      const result = tg.cancelTask(task.id, c.version);
      expect(result).toBe(false);
    });
  });

  describe("retryTask", () => {
    it("retries a failed task", () => {
      const task = tg.createTask({ title: "Retry Me" });
      tg.assignTask(task.id, "agent-1", task.version);
      const a = tg.getTask(task.id)!;
      tg.startTask(task.id, a.version);
      const r = tg.getTask(task.id)!;
      tg.failTask(task.id, r.version, "Oops");

      const result = tg.retryTask(task.id, "agent-2");
      expect(result).toBe(true);

      const retried = tg.getTask(task.id)!;
      expect(retried.status).toBe("assigned");
      expect(retried.ownerAgentId).toBe("agent-2");
      expect(retried.errorMessage).toBeNull();
    });

    it("resets to pending when no agent specified", () => {
      const task = tg.createTask({ title: "Retry Pending" });
      tg.assignTask(task.id, "agent-1", task.version);
      const a = tg.getTask(task.id)!;
      tg.startTask(task.id, a.version);
      const r = tg.getTask(task.id)!;
      tg.failTask(task.id, r.version, "Oops");

      const result = tg.retryTask(task.id);
      expect(result).toBe(true);

      const retried = tg.getTask(task.id)!;
      expect(retried.status).toBe("pending");
      expect(retried.ownerAgentId).toBeNull();
    });

    it("cannot retry non-failed task", () => {
      const task = tg.createTask({ title: "Not Failed" });
      const result = tg.retryTask(task.id);
      expect(result).toBe(false);
    });

    it("cannot retry when retries exhausted", () => {
      const task = tg.createTask({ title: "Exhausted", maxRetries: 0 });
      tg.assignTask(task.id, "agent-1", task.version);
      const a = tg.getTask(task.id)!;
      tg.startTask(task.id, a.version);
      const r = tg.getTask(task.id)!;
      tg.failTask(task.id, r.version, "Oops");

      const result = tg.retryTask(task.id);
      expect(result).toBe(false);
    });
  });

  describe("dependency chains", () => {
    it("handles diamond dependencies correctly", () => {
      // A -> B, A -> C, B -> D, C -> D (diamond)
      const a = tg.createTask({ title: "A" });
      const b = tg.createTask({ title: "B", dependsOn: [a.id] });
      const c = tg.createTask({ title: "C", dependsOn: [a.id] });
      const d = tg.createTask({ title: "D", dependsOn: [b.id, c.id] });

      expect(tg.getTask(b.id)!.status).toBe("blocked");
      expect(tg.getTask(c.id)!.status).toBe("blocked");
      expect(tg.getTask(d.id)!.status).toBe("blocked");

      // Complete A -> unblocks B and C
      tg.assignTask(a.id, "agent-1", a.version);
      const a1 = tg.getTask(a.id)!;
      tg.startTask(a.id, a1.version);
      const a2 = tg.getTask(a.id)!;
      const { unblockedTasks: afterA } = tg.completeTask(a.id, a2.version);
      expect(afterA.map((t) => t.title).sort()).toEqual(["B", "C"]);
      expect(tg.getTask(d.id)!.status).toBe("blocked"); // D still blocked

      // Complete B -> D still blocked (C not done)
      const bFresh = tg.getTask(b.id)!;
      tg.assignTask(b.id, "agent-1", bFresh.version);
      const b1 = tg.getTask(b.id)!;
      tg.startTask(b.id, b1.version);
      const b2 = tg.getTask(b.id)!;
      const { unblockedTasks: afterB } = tg.completeTask(b.id, b2.version);
      expect(afterB).toHaveLength(0);
      expect(tg.getTask(d.id)!.status).toBe("blocked");

      // Complete C -> D unblocked
      const cFresh = tg.getTask(c.id)!;
      tg.assignTask(c.id, "agent-1", cFresh.version);
      const c1 = tg.getTask(c.id)!;
      tg.startTask(c.id, c1.version);
      const c2 = tg.getTask(c.id)!;
      const { unblockedTasks: afterC } = tg.completeTask(c.id, c2.version);
      expect(afterC).toHaveLength(1);
      expect(afterC[0].id).toBe(d.id);
      expect(tg.getTask(d.id)!.status).toBe("pending");
    });
  });

  describe("getNextTask", () => {
    it("returns highest priority unblocked task", () => {
      tg.createTask({ title: "Low Priority", priority: 4 });
      tg.createTask({ title: "High Priority", priority: 1 });
      tg.createTask({ title: "Normal Priority", priority: 3 });

      const next = tg.getNextTask();
      expect(next).not.toBeNull();
      expect(next!.title).toBe("High Priority");
    });

    it("prefers tasks matching agent capabilities", () => {
      tg.createTask({ title: "General", requiredCapabilities: [] });
      tg.createTask({ title: "Needs Testing", requiredCapabilities: ["testing"] });
      tg.createTask({ title: "Needs Review", requiredCapabilities: ["code-review"] });

      const next = tg.getNextTask(["testing"]);
      expect(next).not.toBeNull();
      expect(next!.title).toBe("Needs Testing");
    });

    it("returns null when no tasks available", () => {
      expect(tg.getNextTask()).toBeNull();
    });
  });

  describe("capability profiles", () => {
    it("upserts and retrieves a profile", () => {
      tg.upsertCapabilityProfile({
        agentId: "agent-1",
        capabilities: { "code-review": 0.8, testing: 0.6 },
        successRate: {},
        totalCompleted: 0,
        totalFailed: 0,
        updatedAt: new Date().toISOString(),
      });

      const profile = tg.getCapabilityProfile("agent-1");
      expect(profile).not.toBeNull();
      expect(profile!.capabilities).toEqual({ "code-review": 0.8, testing: 0.6 });
    });

    it("records task outcomes and updates success rate", () => {
      tg.recordTaskOutcome("agent-1", ["testing"], true);
      tg.recordTaskOutcome("agent-1", ["testing"], true);
      tg.recordTaskOutcome("agent-1", ["testing"], false);

      const profile = tg.getCapabilityProfile("agent-1")!;
      expect(profile.totalCompleted).toBe(2);
      expect(profile.totalFailed).toBe(1);
      // Success rate uses exponential moving average, hard to assert exact value
      expect(profile.successRate.testing).toBeGreaterThan(0);
      expect(profile.successRate.testing).toBeLessThan(1);
    });

    it("scores agents based on capability match", () => {
      tg.upsertCapabilityProfile({
        agentId: "agent-good",
        capabilities: { testing: 0.9 },
        successRate: { testing: 0.95 },
        totalCompleted: 10,
        totalFailed: 0,
        updatedAt: new Date().toISOString(),
      });

      tg.upsertCapabilityProfile({
        agentId: "agent-bad",
        capabilities: { testing: 0.2 },
        successRate: { testing: 0.3 },
        totalCompleted: 3,
        totalFailed: 7,
        updatedAt: new Date().toISOString(),
      });

      const task = tg.createTask({ title: "Test Task", requiredCapabilities: ["testing"] });

      const goodScore = tg.scoreAgent("agent-good", task);
      const badScore = tg.scoreAgent("agent-bad", task);
      expect(goodScore).toBeGreaterThan(badScore);
    });

    it("returns low score for unknown agents", () => {
      const task = tg.createTask({ title: "Task" });
      const score = tg.scoreAgent("unknown-agent", task);
      expect(score).toBe(0.1);
    });
  });

  describe("getSummary", () => {
    it("returns correct status counts", () => {
      tg.createTask({ title: "Pending 1" });
      tg.createTask({ title: "Pending 2" });
      const t3 = tg.createTask({ title: "To Assign" });
      tg.assignTask(t3.id, "agent-1", t3.version);

      const summary = tg.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.byStatus.pending).toBe(2);
      expect(summary.byStatus.assigned).toBe(1);
    });
  });

  describe("cleanupForAgent", () => {
    it("resets assigned/running tasks to pending", () => {
      const t1 = tg.createTask({ title: "Assigned" });
      const t2 = tg.createTask({ title: "Also Assigned" });
      tg.assignTask(t1.id, "agent-1", t1.version);
      tg.assignTask(t2.id, "agent-1", t2.version);
      const a2 = tg.getTask(t2.id)!;
      tg.startTask(t2.id, a2.version);

      const count = tg.cleanupForAgent("agent-1");
      expect(count).toBe(2);

      expect(tg.getTask(t1.id)!.status).toBe("pending");
      expect(tg.getTask(t1.id)!.ownerAgentId).toBeNull();
      expect(tg.getTask(t2.id)!.status).toBe("pending");
    });
  });

  describe("persistence", () => {
    it("survives close and reopen", () => {
      tg.createTask({ title: "Persistent Task" });
      tg.close();

      const tg2 = new TaskGraph(TEST_DB_PATH);
      const tasks = tg2.queryTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("Persistent Task");
      tg2.close();

      // Reassign for afterEach cleanup
      tg = new TaskGraph(TEST_DB_PATH);
    });
  });
});
