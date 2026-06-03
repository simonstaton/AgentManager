import { describe, expect, it } from "vitest";
import type { EventPipeline } from "./event-pipeline";
import { capOversizedToolResults, cleanupAllProcesses, killProcessGroup, ProcessManager } from "./process-manager";
import type { AgentRegistry } from "./usage-tracker";

// ---------------------------------------------------------------------------
// capOversizedToolResults
// ---------------------------------------------------------------------------
describe("capOversizedToolResults", () => {
  it("returns event unchanged when no message property", () => {
    const event = { type: "user_prompt", text: "hello" };
    const result = capOversizedToolResults("agent-1", event, 100);
    expect(result).toBe(event);
  });

  it("returns event unchanged when message has no content", () => {
    const event = { type: "assistant", message: { role: "assistant" } };
    const result = capOversizedToolResults("agent-1", event, 100);
    expect(result).toBe(event);
  });

  it("returns event unchanged when content is not an array", () => {
    const event = { type: "assistant", message: { content: "text" } };
    const result = capOversizedToolResults("agent-1", event, 100);
    expect(result).toBe(event);
  });

  it("passes through tool_result blocks under the size limit", () => {
    const smallBody = "x".repeat(50);
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "tool_result", content: smallBody }],
      },
    };
    capOversizedToolResults("agent-1", event, 100);
    expect((event.message.content[0] as { content: string }).content).toBe(smallBody);
  });

  it("elides tool_result body that exceeds the byte limit", () => {
    const bigBody = "x".repeat(200);
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "tool_result", content: bigBody }],
      },
    };
    capOversizedToolResults("agent-1", event, 100);
    const replaced = (event.message.content[0] as { content: string }).content;
    expect(replaced).toContain("bytes elided");
    expect(replaced).not.toBe(bigBody);
  });

  it("handles tool_result content as array of text parts", () => {
    const bigText = "y".repeat(200);
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "tool_result", content: [{ type: "text", text: bigText }] }],
      },
    };
    capOversizedToolResults("agent-1", event, 100);
    const replaced = (event.message.content[0] as { content: unknown }).content;
    expect(typeof replaced).toBe("string");
    expect(replaced as string).toContain("bytes elided");
  });

  it("skips non-tool_result blocks", () => {
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "plain text" }],
      },
    };
    const original = JSON.stringify(event);
    capOversizedToolResults("agent-1", event, 10);
    expect(JSON.stringify(event)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// killProcessGroup
// ---------------------------------------------------------------------------
describe("killProcessGroup", () => {
  it("is a no-op when proc is already killed", () => {
    const proc = { killed: true, pid: 42 } as Parameters<typeof killProcessGroup>[0];
    expect(() => killProcessGroup(proc)).not.toThrow();
  });

  it("is a no-op when proc has no pid", () => {
    const proc = { killed: false, pid: undefined } as Parameters<typeof killProcessGroup>[0];
    expect(() => killProcessGroup(proc)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// cleanupAllProcesses
// ---------------------------------------------------------------------------
describe("cleanupAllProcesses", () => {
  it("returns immediately with empty pids array", () => {
    expect(() => cleanupAllProcesses([])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ProcessManager.buildClaudeArgs
// ---------------------------------------------------------------------------
describe("ProcessManager.buildClaudeArgs", () => {
  const pm = new ProcessManager(new Map() as unknown as AgentRegistry, {} as unknown as EventPipeline, {
    onAgentUpdated: () => {},
    onIdle: () => {},
    onEphemeralIdle: () => {},
  });

  it("includes --dangerously-skip-permissions by default (headless agents)", () => {
    const args = pm.buildClaudeArgs({ prompt: "hello" }, "claude-sonnet-4-6");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes --dangerously-skip-permissions when flag is true", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi", dangerouslySkipPermissions: true }, "claude-sonnet-4-6");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("omits --dangerously-skip-permissions when flag is explicitly false", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi", dangerouslySkipPermissions: false }, "claude-sonnet-4-6");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("uses --permission-mode instead when permissionMode is set", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi", permissionMode: "plan" }, "claude-sonnet-4-6");
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("includes --include-partial-messages", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi" }, "claude-sonnet-4-6");
    expect(args).toContain("--include-partial-messages");
  });

  it("includes --model", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi" }, "claude-opus-4-8");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-4-8");
  });

  it("includes --max-turns with default 200", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi" }, "claude-sonnet-4-6");
    expect(args).toContain("--max-turns");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("200");
  });

  it("includes --max-turns with custom value", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi", maxTurns: 50 }, "claude-sonnet-4-6");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("50");
  });

  it("includes --resume when resumeSessionId provided", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi" }, "claude-sonnet-4-6", "session-abc");
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("session-abc");
  });

  it("includes --effort when set", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi", effort: "high" }, "claude-sonnet-4-6");
    expect(args).toContain("--effort");
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
  });

  it("includes --allowedTools when set", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi", allowedTools: ["Bash", "Read"] }, "claude-sonnet-4-6");
    expect(args).toContain("--allowedTools");
  });

  it("includes --max-budget-usd when set", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi", maxBudgetUsd: 0.5 }, "claude-sonnet-4-6");
    expect(args).toContain("--max-budget-usd");
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("0.5");
  });

  it("uses --fork-session when forkSessionId is set", () => {
    const args = pm.buildClaudeArgs({ prompt: "hi", forkSessionId: "fork-abc" }, "claude-sonnet-4-6");
    expect(args).toContain("--fork-session");
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("fork-abc");
  });

  it("ends with --print -- prompt", () => {
    const args = pm.buildClaudeArgs({ prompt: "my task" }, "claude-sonnet-4-6");
    expect(args[args.length - 1]).toBe("my task");
    expect(args[args.length - 2]).toBe("--");
    expect(args[args.length - 3]).toBe("--print");
  });
});
