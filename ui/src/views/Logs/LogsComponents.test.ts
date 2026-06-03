import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../../api";
import type { AgentLogEntry } from "../../hooks/useAllAgentLogs";
import { agentColor, FILTER_KINDS, flattenEntry, KIND_STYLES } from "./LogsComponents";

// ─── agentColor ───────────────────────────────────────────────────────────────

describe("agentColor", () => {
  it("returns an object with text, bg, and border keys", () => {
    const color = agentColor("agent-abc-123");
    expect(color).toHaveProperty("text");
    expect(color).toHaveProperty("bg");
    expect(color).toHaveProperty("border");
  });

  it("returns the same color for the same agentId (deterministic)", () => {
    const id = "stable-agent-id";
    expect(agentColor(id)).toEqual(agentColor(id));
  });

  it("returns a tailwind text class", () => {
    const { text } = agentColor("some-id");
    expect(text).toMatch(/^text-/);
  });

  it("returns different colors for different agent IDs most of the time", () => {
    const ids = ["agent-a", "agent-b", "agent-c", "agent-d", "agent-e"];
    const texts = ids.map((id) => agentColor(id).text);
    const unique = new Set(texts);
    expect(unique.size).toBeGreaterThan(1);
  });
});

// ─── KIND_STYLES ─────────────────────────────────────────────────────────────

describe("KIND_STYLES", () => {
  it("has entries for all expected kinds", () => {
    const expectedKinds = ["output", "error", "system", "tool", "result", "user"] as const;
    for (const kind of expectedKinds) {
      expect(KIND_STYLES[kind]).toBeDefined();
      expect(KIND_STYLES[kind].prefix).toBeTruthy();
      expect(KIND_STYLES[kind].textColor).toMatch(/^text-/);
    }
  });

  it("error kind has red styling", () => {
    expect(KIND_STYLES.error.textColor).toContain("red");
  });

  it("result kind has emerald styling", () => {
    expect(KIND_STYLES.result.textColor).toContain("emerald");
  });
});

// ─── FILTER_KINDS ─────────────────────────────────────────────────────────────

describe("FILTER_KINDS", () => {
  it("has an 'All' filter as the first entry", () => {
    expect(FILTER_KINDS[0].label).toBe("All");
  });

  it("All filter includes all 6 kinds", () => {
    expect(FILTER_KINDS[0].kinds).toHaveLength(6);
  });

  it("Errors filter includes only error kind", () => {
    const errorsFilter = FILTER_KINDS.find((f) => f.label === "Errors");
    expect(errorsFilter).toBeDefined();
    expect(errorsFilter?.kinds).toEqual(["error"]);
  });
});

// ─── flattenEntry ─────────────────────────────────────────────────────────────

function makeEntry(event: StreamEvent): AgentLogEntry {
  return {
    id: "entry-1",
    agentId: "agent-123",
    agentName: "Test Agent",
    timestamp: new Date("2026-01-01T12:00:00Z"),
    event,
  };
}

describe("flattenEntry", () => {
  it("returns empty array for unrecognized event type", () => {
    const entry = makeEntry({ type: "unknown_type" } as unknown as StreamEvent);
    expect(flattenEntry(entry)).toHaveLength(0);
  });

  it("parses stderr event into an error entry", () => {
    const entry = makeEntry({ type: "stderr", text: "some error occurred" } as StreamEvent);
    const flat = flattenEntry(entry);
    expect(flat).toHaveLength(1);
    expect(flat[0].parsed.kind).toBe("error");
    expect(flat[0].parsed.text).toBe("some error occurred");
  });

  it("ignores empty stderr", () => {
    const entry = makeEntry({ type: "stderr", text: "   " } as StreamEvent);
    expect(flattenEntry(entry)).toHaveLength(0);
  });

  it("parses result event", () => {
    const entry = makeEntry({ type: "result", result: "Task complete" } as StreamEvent);
    const flat = flattenEntry(entry);
    expect(flat).toHaveLength(1);
    expect(flat[0].parsed.kind).toBe("result");
    expect(flat[0].parsed.text).toBe("Task complete");
  });

  it("parses user_prompt event", () => {
    const entry = makeEntry({ type: "user_prompt", text: "Hello agent" } as StreamEvent);
    const flat = flattenEntry(entry);
    expect(flat).toHaveLength(1);
    expect(flat[0].parsed.kind).toBe("user");
  });

  it("parses system init event", () => {
    const entry = makeEntry({
      type: "system",
      subtype: "init",
      model: "claude-opus-4",
    } as unknown as StreamEvent);
    const flat = flattenEntry(entry);
    expect(flat).toHaveLength(1);
    expect(flat[0].parsed.kind).toBe("system");
    expect(flat[0].parsed.text).toContain("Session started");
    expect(flat[0].parsed.text).toContain("claude-opus-4");
  });

  it("parses assistant text block", () => {
    const entry = makeEntry({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "I will help you." }],
      },
    } as unknown as StreamEvent);
    const flat = flattenEntry(entry);
    expect(flat).toHaveLength(1);
    expect(flat[0].parsed.kind).toBe("output");
    expect(flat[0].parsed.text).toBe("I will help you.");
  });

  it("parses assistant tool_use block with Bash summary", () => {
    const entry = makeEntry({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { command: "ls /tmp" } }],
      },
    } as unknown as StreamEvent);
    const flat = flattenEntry(entry);
    expect(flat).toHaveLength(1);
    expect(flat[0].parsed.kind).toBe("tool");
    expect(flat[0].parsed.toolName).toBe("Bash");
    expect(flat[0].parsed.text).toContain("ls /tmp");
  });

  it("assigns unique ids to multiple blocks from one entry", () => {
    const entry = makeEntry({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Block one" },
          { type: "text", text: "Block two" },
        ],
      },
    } as unknown as StreamEvent);
    const flat = flattenEntry(entry);
    expect(flat).toHaveLength(2);
    const ids = flat.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("preserves agentId and agentName from the entry", () => {
    const entry = makeEntry({ type: "stderr", text: "err" } as StreamEvent);
    const flat = flattenEntry(entry);
    expect(flat[0].agentId).toBe("agent-123");
    expect(flat[0].agentName).toBe("Test Agent");
  });
});
