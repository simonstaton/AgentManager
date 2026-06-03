import express, { type Request, type Response } from "express";
import type { AgentManager } from "../agents";
import { logger } from "../logger";
import { param } from "../utils/express";
import { checkDangerousCommand } from "./hook-config";

// ── Tool timeline in-memory store ─────────────────────────────────────────────

export interface ToolTimelineEntry {
  tool: string;
  inputPreview: string;
  timestamp: string;
  durationMs?: number;
  outcome: "allowed" | "blocked";
}

const MAX_TIMELINE_ENTRIES = 100;

// Map from agentId -> list of timeline entries (most recent last)
const toolTimelines = new Map<string, ToolTimelineEntry[]>();
// Track pending PreToolUse entries awaiting PostToolUse to compute duration
const pendingToolStarts = new Map<
  string,
  { tool: string; inputPreview: string; startMs: number; outcome: "allowed" | "blocked" }
>();

function getTimeline(agentId: string): ToolTimelineEntry[] {
  let entries = toolTimelines.get(agentId);
  if (!entries) {
    entries = [];
    toolTimelines.set(agentId, entries);
  }
  return entries;
}

function appendTimelineEntry(agentId: string, entry: ToolTimelineEntry): void {
  const entries = getTimeline(agentId);
  entries.push(entry);
  if (entries.length > MAX_TIMELINE_ENTRIES) {
    entries.splice(0, entries.length - MAX_TIMELINE_ENTRIES);
  }
}

function buildInputPreview(tool_name: string, tool_input: Record<string, unknown> | undefined): string {
  if (!tool_input) return "";
  const raw = (() => {
    switch (tool_name) {
      case "Bash":
        return String(tool_input.command || "");
      case "Read":
      case "Write":
      case "Edit":
        return String(tool_input.file_path || "");
      case "Glob":
      case "Grep":
        return String(tool_input.pattern || "");
      case "WebFetch":
        return String(tool_input.url || "");
      case "WebSearch":
        return String(tool_input.query || "");
      default: {
        const keys = Object.keys(tool_input);
        if (keys.length === 0) return "";
        const first = tool_input[keys[0]];
        return typeof first === "string" ? first : JSON.stringify(first);
      }
    }
  })();
  return raw.slice(0, 200);
}

export function createHooksRouter(agentManager: AgentManager) {
  const router = express.Router();

  // POST /api/hooks/:agentId/pre-tool-use
  // Synchronous hook: validates Bash commands against a dangerous-command blocklist.
  router.post("/api/hooks/:agentId/pre-tool-use", (req: Request, res: Response) => {
    const agentId = param(req.params.agentId);
    if (!agentManager.get(agentId)) {
      res.status(404).json({ error: `Agent ${agentId} not found` });
      return;
    }

    const { tool_name, tool_input, session_id } = req.body ?? {};
    logger.info("[hooks] PreToolUse", { agentId: agentId.slice(0, 8), toolName: tool_name, sessionId: session_id });

    let outcome: "allowed" | "blocked" = "allowed";
    let blockReason: string | null = null;

    if (tool_name === "Bash" && typeof tool_input?.command === "string") {
      blockReason = checkDangerousCommand(tool_input.command);
      if (blockReason) {
        outcome = "blocked";
        logger.warn("[hooks] PreToolUse blocked", {
          agentId: agentId.slice(0, 8),
          command: tool_input.command,
          reason: blockReason,
        });
      }
    }

    // Record start of tool use for timeline (duration computed on PostToolUse)
    const pendingKey = `${agentId}:${tool_name}`;
    pendingToolStarts.set(pendingKey, {
      tool: String(tool_name || "unknown"),
      inputPreview: buildInputPreview(String(tool_name || ""), tool_input as Record<string, unknown> | undefined),
      startMs: Date.now(),
      outcome,
    });

    if (outcome === "blocked" && blockReason) {
      // Also record blocked entry immediately (no PostToolUse will fire for blocked tools)
      appendTimelineEntry(agentId, {
        tool: String(tool_name || "unknown"),
        inputPreview: buildInputPreview(String(tool_name || ""), tool_input as Record<string, unknown> | undefined),
        timestamp: new Date().toISOString(),
        outcome: "blocked",
      });
      pendingToolStarts.delete(pendingKey);

      res.json({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: blockReason,
        },
      });
      return;
    }

    res.json({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  });

  // POST /api/hooks/:agentId/post-tool-use
  // Async observational hook: logs tool usage metrics and records timeline entry.
  router.post("/api/hooks/:agentId/post-tool-use", (req: Request, res: Response) => {
    const agentId = param(req.params.agentId);
    if (!agentManager.get(agentId)) {
      res.status(404).json({ error: `Agent ${agentId} not found` });
      return;
    }
    const { tool_name, session_id } = req.body ?? {};
    logger.info("[hooks] PostToolUse", { agentId: agentId.slice(0, 8), toolName: tool_name, sessionId: session_id });

    // Finalise timeline entry with duration
    const pendingKey = `${agentId}:${tool_name}`;
    const pending = pendingToolStarts.get(pendingKey);
    if (pending) {
      pendingToolStarts.delete(pendingKey);
      appendTimelineEntry(agentId, {
        tool: pending.tool,
        inputPreview: pending.inputPreview,
        timestamp: new Date(pending.startMs).toISOString(),
        durationMs: Date.now() - pending.startMs,
        outcome: pending.outcome,
      });
    }

    res.json({});
  });

  // GET /api/hooks/:agentId/timeline
  // Returns the tool execution timeline for an agent (last 100 entries).
  router.get("/api/hooks/:agentId/timeline", (req: Request, res: Response) => {
    const agentId = param(req.params.agentId);
    if (!agentManager.get(agentId)) {
      res.status(404).json({ error: `Agent ${agentId} not found` });
      return;
    }
    const entries = getTimeline(agentId);
    res.json({ timeline: entries });
  });

  // POST /api/hooks/:agentId/stop
  // Async observational hook: turn completion notification.
  router.post("/api/hooks/:agentId/stop", (req: Request, res: Response) => {
    const agentId = param(req.params.agentId);
    if (!agentManager.get(agentId)) {
      res.status(404).json({ error: `Agent ${agentId} not found` });
      return;
    }
    const { session_id } = req.body ?? {};
    logger.info("[hooks] Stop", { agentId: agentId.slice(0, 8), sessionId: session_id });
    res.json({});
  });

  // POST /api/hooks/:agentId/subagent-start
  // Async observational hook: sub-agent spawn tracking.
  router.post("/api/hooks/:agentId/subagent-start", (req: Request, res: Response) => {
    const agentId = param(req.params.agentId);
    if (!agentManager.get(agentId)) {
      res.status(404).json({ error: `Agent ${agentId} not found` });
      return;
    }
    const { session_id } = req.body ?? {};
    logger.info("[hooks] SubagentStart", { agentId: agentId.slice(0, 8), sessionId: session_id });
    res.json({});
  });

  // POST /api/hooks/:agentId/subagent-stop
  // Async observational hook: sub-agent completion tracking.
  router.post("/api/hooks/:agentId/subagent-stop", (req: Request, res: Response) => {
    const agentId = param(req.params.agentId);
    if (!agentManager.get(agentId)) {
      res.status(404).json({ error: `Agent ${agentId} not found` });
      return;
    }
    const { session_id } = req.body ?? {};
    logger.info("[hooks] SubagentStop", { agentId: agentId.slice(0, 8), sessionId: session_id });
    res.json({});
  });

  return router;
}
