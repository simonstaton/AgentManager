import { describe, expect, it } from "vitest";
import {
  buildSafeLinearUrl,
  evictStaleWorkflows,
  isValidGithubPat,
  isValidLinearApiKey,
  MAX_STORED_WORKFLOWS,
  MAX_WORKFLOWS,
  parseLinearUrl,
  RUNNING_WALL_CLOCK_TIMEOUT_MS,
} from "./workflow-routes-helpers";

describe("constants", () => {
  it("MAX_WORKFLOWS is 5", () => {
    expect(MAX_WORKFLOWS).toBe(5);
  });

  it("MAX_STORED_WORKFLOWS is 50", () => {
    expect(MAX_STORED_WORKFLOWS).toBe(50);
  });

  it("RUNNING_WALL_CLOCK_TIMEOUT_MS is 1 hour", () => {
    expect(RUNNING_WALL_CLOCK_TIMEOUT_MS).toBe(60 * 60_000);
  });
});

describe("isValidLinearApiKey", () => {
  it("accepts valid lin_api_ key with 32+ chars", () => {
    expect(isValidLinearApiKey("lin_api_" + "a".repeat(32))).toBe(true);
  });

  it("rejects key missing lin_api_ prefix", () => {
    expect(isValidLinearApiKey("not_linear_" + "a".repeat(32))).toBe(false);
  });

  it("rejects key with fewer than 32 chars after prefix", () => {
    expect(isValidLinearApiKey("lin_api_short")).toBe(false);
  });

  it("accepts key with underscores and digits after prefix", () => {
    expect(isValidLinearApiKey("lin_api_abc123_DEF456_" + "x".repeat(18))).toBe(true);
  });
});

describe("isValidGithubPat", () => {
  it("accepts classic PAT with ghp_ prefix (36+ chars)", () => {
    expect(isValidGithubPat("ghp_" + "a".repeat(36))).toBe(true);
  });

  it("accepts fine-grained PAT with github_pat_ prefix", () => {
    expect(isValidGithubPat("github_pat_" + "a".repeat(40))).toBe(true);
  });

  it("accepts legacy 40-char hex PAT", () => {
    expect(isValidGithubPat("a".repeat(40))).toBe(true);
  });

  it("rejects short token", () => {
    expect(isValidGithubPat("ghp_short")).toBe(false);
  });

  it("rejects random string", () => {
    expect(isValidGithubPat("not-a-pat")).toBe(false);
  });
});

describe("parseLinearUrl", () => {
  it("parses issue URL", () => {
    const result = parseLinearUrl("https://linear.app/myteam/issue/TEAM-123");
    expect(result).not.toBeNull();
    expect(result?.entityType).toBe("issue");
    expect(result?.entityId).toBe("TEAM-123");
    expect(result?.workspace).toBe("myteam");
    expect(result?.team).toBe("TEAM");
  });

  it("parses project URL", () => {
    const result = parseLinearUrl("https://linear.app/myteam/project/my-project-slug");
    expect(result?.entityType).toBe("project");
    expect(result?.entityId).toBe("my-project-slug");
  });

  it("parses cycle URL", () => {
    const result = parseLinearUrl("https://linear.app/myteam/cycle/abc-123");
    expect(result?.entityType).toBe("cycle");
  });

  it("parses view URL", () => {
    const result = parseLinearUrl("https://linear.app/myteam/view/view-id");
    expect(result?.entityType).toBe("view");
  });

  it("returns null for non-Linear URL", () => {
    expect(parseLinearUrl("https://github.com/org/repo")).toBeNull();
  });

  it("returns null for spoofed linear.app domain", () => {
    expect(parseLinearUrl("https://evil-linear.app/myteam/issue/TEAM-1")).toBeNull();
  });
});

describe("buildSafeLinearUrl", () => {
  it("reconstructs issue URL", () => {
    const url = buildSafeLinearUrl({ workspace: "ws", entityType: "issue", entityId: "ENG-42" });
    expect(url).toBe("https://linear.app/ws/issue/ENG-42");
  });

  it("reconstructs project URL", () => {
    const url = buildSafeLinearUrl({ workspace: "ws", entityType: "project", entityId: "proj-slug" });
    expect(url).toBe("https://linear.app/ws/project/proj-slug");
  });
});

describe("evictStaleWorkflows", () => {
  function makeWorkflow(id: string, status: string, createdAt: string) {
    return {
      id,
      linearUrl: "https://linear.app/w/issue/T-1",
      repository: "org/repo",
      status: status as "completed",
      agents: [],
      createdAt,
      updatedAt: createdAt,
    };
  }

  it("does not evict when under limit", () => {
    const workflows = new Map();
    workflows.set("a", makeWorkflow("a", "completed", "2026-01-01T00:00:00Z"));
    evictStaleWorkflows(workflows);
    expect(workflows.size).toBe(1);
  });

  it("evicts oldest terminal workflows when over MAX_STORED_WORKFLOWS", () => {
    const workflows = new Map();
    for (let i = 0; i <= MAX_STORED_WORKFLOWS; i++) {
      const date = new Date(2026, 0, i + 1).toISOString();
      workflows.set(`wf-${i}`, makeWorkflow(`wf-${i}`, "completed", date));
    }
    expect(workflows.size).toBe(MAX_STORED_WORKFLOWS + 1);
    evictStaleWorkflows(workflows);
    expect(workflows.size).toBe(MAX_STORED_WORKFLOWS);
    // Oldest (wf-0) should be evicted
    expect(workflows.has("wf-0")).toBe(false);
  });

  it("does not evict running workflows", () => {
    const workflows = new Map();
    for (let i = 0; i <= MAX_STORED_WORKFLOWS; i++) {
      const date = new Date(2026, 0, i + 1).toISOString();
      workflows.set(`wf-${i}`, makeWorkflow(`wf-${i}`, "running", date));
    }
    const sizeBefore = workflows.size;
    evictStaleWorkflows(workflows);
    expect(workflows.size).toBe(sizeBefore); // nothing evicted — all running
  });
});
