import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_ACTIVE_WORKFLOWS, WorkflowEngine } from "./workflow-engine";

let tmpDir: string;
let engine: WorkflowEngine;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "wf-engine-test-"));
  engine = new WorkflowEngine(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  engine.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("WorkflowEngine — table creation", () => {
  it("creates workflow_runs and workflow_agents tables on construction", () => {
    // If tables weren't created, create() would throw — this verifies the schema
    const run = engine.create({ linearUrl: "https://linear.app/acme/issue/ENG-1", repository: "acme/repo" });
    expect(run.id).toBeTruthy();
  });
});

describe("WorkflowEngine — create", () => {
  it("creates a workflow run with required fields", () => {
    const run = engine.create({
      linearUrl: "https://linear.app/acme/issue/ENG-42",
      repository: "acme/backend",
    });
    expect(run.status).toBe("created");
    expect(run.linearUrl).toBe("https://linear.app/acme/issue/ENG-42");
    expect(run.repository).toBe("acme/backend");
    expect(run.taskCount).toBe(0);
    expect(run.createdAt).toBeTruthy();
    expect(run.updatedAt).toBeTruthy();
  });

  it("persists optional linearIssueId", () => {
    const run = engine.create({
      linearUrl: "https://linear.app/acme/issue/ENG-1",
      repository: "acme/repo",
      linearIssueId: "abc-123",
    });
    expect(run.linearIssueId).toBe("abc-123");
  });

  it("persists metadata as a parsed object", () => {
    const run = engine.create({
      linearUrl: "https://linear.app/acme/issue/ENG-1",
      repository: "acme/repo",
      metadata: { key: "value", num: 42 },
    });
    expect(run.metadata).toEqual({ key: "value", num: 42 });
  });

  it(`throws when ${MAX_ACTIVE_WORKFLOWS} active workflows exist`, () => {
    for (let i = 0; i < MAX_ACTIVE_WORKFLOWS; i++) {
      engine.create({ linearUrl: `https://linear.app/acme/issue/ENG-${i}`, repository: "acme/repo" });
    }
    expect(() => engine.create({ linearUrl: "https://linear.app/acme/issue/ENG-99", repository: "acme/repo" })).toThrow(
      /Maximum.*concurrent workflows/,
    );
  });
});

describe("WorkflowEngine — get / list", () => {
  it("returns null for unknown id", () => {
    expect(engine.get("nonexistent-id")).toBeNull();
  });

  it("retrieves a run by id", () => {
    const created = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/repo" });
    const fetched = engine.get(created.id);
    expect(fetched?.id).toBe(created.id);
  });

  it("lists all created runs", () => {
    const r1 = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    const r2 = engine.create({ linearUrl: "https://linear.app/a/issue/X-2", repository: "a/r" });
    const runs = engine.list();
    const ids = runs.map((r) => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r2.id);
    expect(runs.length).toBe(2);
  });

  it("listActive excludes terminal states", () => {
    const active = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    const done = engine.create({ linearUrl: "https://linear.app/a/issue/X-2", repository: "a/r" });
    engine.transition(done.id, "estimating");
    engine.transition(done.id, "awaiting_confirm");
    engine.transition(done.id, "running");
    engine.transition(done.id, "in_review");
    engine.transition(done.id, "merging");
    engine.transition(done.id, "completed");
    const active_list = engine.listActive();
    const ids = active_list.map((r) => r.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(done.id);
  });
});

describe("WorkflowEngine — state machine", () => {
  it("allows valid transitions", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    const t1 = engine.transition(run.id, "estimating");
    expect(t1.status).toBe("estimating");
    const t2 = engine.transition(run.id, "awaiting_confirm");
    expect(t2.status).toBe("awaiting_confirm");
  });

  it("rejects invalid transitions", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    // created → in_review is not allowed
    expect(() => engine.transition(run.id, "in_review")).toThrow(/Invalid transition/);
  });

  it("stores an error string when transitioning to failed", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    const failed = engine.transition(run.id, "failed", "something went wrong");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("something went wrong");
  });

  it("blocks transitions from terminal states", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.transition(run.id, "cancelled");
    expect(() => engine.transition(run.id, "estimating")).toThrow(/terminal state/);
  });

  it("isTerminal returns true for completed/failed/cancelled", () => {
    const r1 = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.transition(r1.id, "failed");
    expect(engine.isTerminal(r1.id)).toBe(true);

    const r2 = engine.create({ linearUrl: "https://linear.app/a/issue/X-2", repository: "a/r" });
    expect(engine.isTerminal(r2.id)).toBe(false);
  });

  it("isTerminal returns true for unknown ids", () => {
    expect(engine.isTerminal("does-not-exist")).toBe(true);
  });
});

describe("WorkflowEngine — field updates", () => {
  it("sets phase", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.setPhase(run.id, "triage");
    expect(engine.get(run.id)?.phase).toBe("triage");
  });

  it("sets cost estimate and actual", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.setCostEstimate(run.id, 1.5);
    engine.setCostActual(run.id, 0.8);
    const fetched = engine.get(run.id);
    expect(fetched?.costEstimateUsd).toBe(1.5);
    expect(fetched?.costActualUsd).toBe(0.8);
  });

  it("sets pr_url", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.setPrUrl(run.id, "https://github.com/acme/repo/pull/42");
    expect(engine.get(run.id)?.prUrl).toBe("https://github.com/acme/repo/pull/42");
  });

  it("sets task count", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.setTaskCount(run.id, 7);
    expect(engine.get(run.id)?.taskCount).toBe(7);
  });

  it("sets metadata", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.setMetadata(run.id, { foo: "bar" });
    expect(engine.get(run.id)?.metadata).toEqual({ foo: "bar" });
  });
});

describe("WorkflowEngine — agent tracking", () => {
  it("adds and retrieves agents", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.addAgent(run.id, "agent-abc", "developer");
    const agents = engine.getAgents(run.id);
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe("agent-abc");
    expect(agents[0].role).toBe("developer");
  });

  it("removes an agent", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.addAgent(run.id, "agent-abc", "developer");
    engine.removeAgent(run.id, "agent-abc");
    expect(engine.getAgents(run.id)).toHaveLength(0);
  });

  it("looks up workflow by agent id", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.addAgent(run.id, "agent-xyz", "reviewer");
    expect(engine.getWorkflowForAgent("agent-xyz")).toBe(run.id);
    expect(engine.getWorkflowForAgent("unknown-agent")).toBeNull();
  });

  it("updates agent status", () => {
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.addAgent(run.id, "agent-abc", "developer");
    engine.updateAgentStatus(run.id, "agent-abc", "running");
    const agents = engine.getAgents(run.id);
    expect(agents[0].status).toBe("running");
  });
});

describe("WorkflowEngine — event emission", () => {
  it("emits status_changed on transition", () => {
    const events: string[] = [];
    engine.subscribe((e) => events.push(e.type));
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.transition(run.id, "estimating");
    expect(events).toContain("status_changed");
  });

  it("emits agent_added and agent_removed", () => {
    const types: string[] = [];
    engine.subscribe((e) => types.push(e.type));
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.addAgent(run.id, "a1", "dev");
    engine.removeAgent(run.id, "a1");
    expect(types).toContain("agent_added");
    expect(types).toContain("agent_removed");
  });

  it("unsubscribe stops future events", () => {
    const events: string[] = [];
    const unsub = engine.subscribe((e) => events.push(e.type));
    unsub();
    const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
    engine.transition(run.id, "estimating");
    expect(events).toHaveLength(0);
  });
});
