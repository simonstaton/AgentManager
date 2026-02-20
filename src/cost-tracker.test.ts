import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CostTracker } from "./cost-tracker";

const TEST_DB_DIR = "/tmp/cost-tracker-test";
const TEST_DB_PATH = path.join(TEST_DB_DIR, "test-costs.db");

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    // Remove existing DB to start fresh
    try {
      unlinkSync(TEST_DB_PATH);
    } catch {}
    try {
      unlinkSync(`${TEST_DB_PATH}-wal`);
    } catch {}
    try {
      unlinkSync(`${TEST_DB_PATH}-shm`);
    } catch {}
    tracker = new CostTracker(TEST_DB_PATH);
  });

  afterEach(() => {
    tracker.close();
  });

  it("upserts and retrieves cost records", () => {
    tracker.upsert({
      agentId: "agent-1",
      agentName: "test-agent",
      model: "claude-sonnet-4-6",
      tokensIn: 1000,
      tokensOut: 500,
      estimatedCost: 0.01,
      createdAt: "2026-02-19T00:00:00Z",
    });

    const records = tracker.getAll();
    expect(records).toHaveLength(1);
    expect(records[0].agentId).toBe("agent-1");
    expect(records[0].agentName).toBe("test-agent");
    expect(records[0].tokensIn).toBe(1000);
    expect(records[0].tokensOut).toBe(500);
    expect(records[0].estimatedCost).toBeCloseTo(0.01);
    expect(records[0].closedAt).toBeNull();
  });

  it("updates existing record on upsert", () => {
    tracker.upsert({
      agentId: "agent-1",
      agentName: "test-agent",
      model: "claude-sonnet-4-6",
      tokensIn: 1000,
      tokensOut: 500,
      estimatedCost: 0.01,
      createdAt: "2026-02-19T00:00:00Z",
    });

    // Update with higher usage
    tracker.upsert({
      agentId: "agent-1",
      agentName: "test-agent",
      model: "claude-sonnet-4-6",
      tokensIn: 5000,
      tokensOut: 2000,
      estimatedCost: 0.05,
      createdAt: "2026-02-19T00:00:00Z",
    });

    const records = tracker.getAll();
    expect(records).toHaveLength(1);
    expect(records[0].tokensIn).toBe(5000);
    expect(records[0].tokensOut).toBe(2000);
    expect(records[0].estimatedCost).toBeCloseTo(0.05);
  });

  it("finalizes a record with closedAt timestamp", () => {
    tracker.upsert({
      agentId: "agent-1",
      agentName: "test-agent",
      model: "claude-sonnet-4-6",
      tokensIn: 1000,
      tokensOut: 500,
      estimatedCost: 0.01,
      createdAt: "2026-02-19T00:00:00Z",
    });

    tracker.finalize("agent-1");

    const records = tracker.getAll();
    expect(records).toHaveLength(1);
    expect(records[0].closedAt).not.toBeNull();
  });

  it("returns correct summary aggregates", () => {
    tracker.upsert({
      agentId: "agent-1",
      agentName: "agent-a",
      model: "claude-sonnet-4-6",
      tokensIn: 1000,
      tokensOut: 500,
      estimatedCost: 0.01,
      createdAt: "2026-02-19T00:00:00Z",
    });
    tracker.upsert({
      agentId: "agent-2",
      agentName: "agent-b",
      model: "claude-opus-4-6",
      tokensIn: 2000,
      tokensOut: 1000,
      estimatedCost: 0.05,
      createdAt: "2026-02-19T01:00:00Z",
    });

    const summary = tracker.getSummary();
    expect(summary.allTimeCost).toBeCloseTo(0.06);
    expect(summary.allTimeTokensIn).toBe(3000);
    expect(summary.allTimeTokensOut).toBe(1500);
    expect(summary.totalRecords).toBe(2);
  });

  it("resets all records", () => {
    tracker.upsert({
      agentId: "agent-1",
      agentName: "test-agent",
      model: "claude-sonnet-4-6",
      tokensIn: 1000,
      tokensOut: 500,
      estimatedCost: 0.01,
      createdAt: "2026-02-19T00:00:00Z",
    });

    const { deleted } = tracker.reset();
    expect(deleted).toBe(1);

    const records = tracker.getAll();
    expect(records).toHaveLength(0);

    const summary = tracker.getSummary();
    expect(summary.allTimeCost).toBe(0);
    expect(summary.totalRecords).toBe(0);
  });

  it("returns empty summary when no records exist", () => {
    const summary = tracker.getSummary();
    expect(summary.allTimeCost).toBe(0);
    expect(summary.allTimeTokensIn).toBe(0);
    expect(summary.allTimeTokensOut).toBe(0);
    expect(summary.totalRecords).toBe(0);
  });

  it("respects limit in getAll", () => {
    for (let i = 0; i < 5; i++) {
      tracker.upsert({
        agentId: `agent-${i}`,
        agentName: `agent-${i}`,
        model: "claude-sonnet-4-6",
        tokensIn: 100 * i,
        tokensOut: 50 * i,
        estimatedCost: 0.001 * i,
        createdAt: `2026-02-19T0${i}:00:00Z`,
      });
    }

    const limited = tracker.getAll(3);
    expect(limited).toHaveLength(3);
  });

  it("survives close and reopen", () => {
    tracker.upsert({
      agentId: "agent-1",
      agentName: "persistent-agent",
      model: "claude-sonnet-4-6",
      tokensIn: 1000,
      tokensOut: 500,
      estimatedCost: 0.01,
      createdAt: "2026-02-19T00:00:00Z",
    });

    tracker.close();

    // Reopen
    const tracker2 = new CostTracker(TEST_DB_PATH);
    const records = tracker2.getAll();
    expect(records).toHaveLength(1);
    expect(records[0].agentName).toBe("persistent-agent");
    tracker2.close();

    // Reassign for afterEach cleanup
    tracker = new CostTracker(TEST_DB_PATH);
  });
});
