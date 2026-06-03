import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkflowEngine } from "./workflow-engine";

describe("WorkflowEngine", () => {
  it("CRUD + state machine smoke test", () => {
    const dir = mkdtempSync("/tmp/wfe-test-");
    const engine = new WorkflowEngine(path.join(dir, "test.db"));
    try {
      const run = engine.create({ linearUrl: "https://linear.app/a/issue/X-1", repository: "a/r" });
      expect(run.status).toBe("created");
      expect(engine.transition(run.id, "estimating").status).toBe("estimating");
      expect(() => engine.transition(run.id, "in_review")).toThrow(/Invalid transition/);
      expect(engine.get("nonexistent")).toBeNull();
    } finally {
      engine.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
