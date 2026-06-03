import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue("[]"),
}));
vi.mock("node:fs/promises", () => ({
  rename: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe("episodic-memory module", () => {
  it("exports core functions", async () => {
    const mod = await import("./episodic-memory");
    expect(mod.getEpisodicLog).toBeDefined();
    expect(mod.appendEpisode).toBeDefined();
    expect(mod.buildResumeContext).toBeDefined();
    expect(mod.queryEpisodes).toBeDefined();
    expect(mod.clearEpisodicLog).toBeDefined();
  });

  it("getEpisodicLog returns an empty log for unknown agent", async () => {
    const { getEpisodicLog } = await import("./episodic-memory");
    const log = getEpisodicLog("unknown-agent");
    expect(log.agentId).toBe("unknown-agent");
    expect(log.entries).toEqual([]);
  });

  it("appendEpisode returns entry with correct fields", async () => {
    const { appendEpisode } = await import("./episodic-memory");
    const entry = await appendEpisode("agent-1", { kind: "task", summary: "did something" });
    expect(entry.agentId).toBe("agent-1");
    expect(entry.kind).toBe("task");
    expect(entry.summary).toBe("did something");
    expect(typeof entry.id).toBe("string");
  });

  it("queryEpisodes filters by kind", async () => {
    const { queryEpisodes, appendEpisode } = await import("./episodic-memory");
    await appendEpisode("agent-filter", { kind: "task", summary: "a task" });
    await appendEpisode("agent-filter", { kind: "note", summary: "a note" });
    const tasks = queryEpisodes("agent-filter", { kinds: ["task"] });
    expect(tasks.every((e) => e.kind === "task")).toBe(true);
  });

  it("buildResumeContext returns a string", async () => {
    const { buildResumeContext } = await import("./episodic-memory");
    const ctx = buildResumeContext("agent-ctx");
    expect(typeof ctx).toBe("string");
  });
});
