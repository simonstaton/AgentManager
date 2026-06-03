/**
 * AgentQueryService — read-only query surface over agent state.
 *
 * Extracted from src/agents.ts (Phase E PR29).
 * Groups the read/metadata methods (metadata, usage, logs, events, git info)
 * plus git-info helpers. Receives shared agents Map, UsageTracker, and EventPipeline.
 */

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { EventPipeline } from "./event-pipeline";
import type { AgentMetadata, AgentUsage, StreamEvent } from "./types";
import type { AgentRegistry, UsageTracker } from "./usage-tracker";

const execFileAsync = promisify(execFile);

async function gitCmd(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf-8", timeout: 3_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function getGitInfo(
  workspaceDir: string,
): Promise<{ repo: string | null; branch: string | null; worktreePath: string | null }> {
  const result = { repo: null as string | null, branch: null as string | null, worktreePath: null as string | null };

  const topLevel = await gitCmd(workspaceDir, ["rev-parse", "--show-toplevel"]);
  if (topLevel) {
    result.branch = await gitCmd(topLevel, ["rev-parse", "--abbrev-ref", "HEAD"]);
    result.repo = await gitCmd(topLevel, ["remote", "get-url", "origin"]);
    const commonDir = await gitCmd(topLevel, ["rev-parse", "--git-common-dir"]);
    const gitDir = await gitCmd(topLevel, ["rev-parse", "--git-dir"]);
    if (commonDir && gitDir && path.resolve(topLevel, commonDir) !== path.resolve(topLevel, gitDir)) {
      result.worktreePath = topLevel;
    }
    return result;
  }

  try {
    const entries = await readdir(workspaceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const subdir = path.join(workspaceDir, entry.name);
      const branch = await gitCmd(subdir, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (branch) {
        result.branch = branch;
        result.repo = await gitCmd(subdir, ["remote", "get-url", "origin"]);
        result.worktreePath = subdir;
        return result;
      }
    }
  } catch {
    // readdir may fail if workspace doesn't exist
  }

  return result;
}

/** Minimal registry interface for reading agent presence + data.
 *  The AgentManager `Map<string, AgentProcess>` satisfies this structurally. */
export interface QueryRegistry extends AgentRegistry {
  has(id: string): boolean;
}

export class AgentQueryService {
  constructor(
    private readonly agents: QueryRegistry,
    private readonly usageTracker: UsageTracker,
    private readonly eventPipeline: EventPipeline,
  ) {}

  async getEvents(id: string): Promise<StreamEvent[]> {
    if (!this.agents.has(id)) return [];
    return this.eventPipeline.readPersistedEvents(id).then(({ events }) => events);
  }

  /** Return token usage and estimated cost for a single agent. */
  getUsage(id: string): AgentUsage | null {
    return this.usageTracker.getUsage(id);
  }

  /** Refresh cached git info on an agent (async, fire-and-forget safe). */
  async refreshGitInfo(id: string): Promise<void> {
    const agentProc = this.agents.get(id);
    if (!agentProc) return;
    const gitInfo = await getGitInfo(agentProc.agent.workspaceDir);
    agentProc.agent.gitBranch = gitInfo.branch ?? undefined;
    agentProc.agent.gitRepo = gitInfo.repo ?? undefined;
    agentProc.agent.gitWorktree = gitInfo.worktreePath ?? undefined;
  }

  /** Return runtime metadata for a single agent (PID, git info, uptime, etc.). */
  async getMetadata(id: string): Promise<AgentMetadata | null> {
    const agentProc = this.agents.get(id);
    if (!agentProc) return null;
    const { agent, proc } = agentProc;
    const uptimeMs = Date.now() - new Date(agent.createdAt).getTime();
    const gitInfo = await getGitInfo(agent.workspaceDir);
    // Update cached git info on the agent object
    agent.gitBranch = gitInfo.branch ?? undefined;
    agent.gitRepo = gitInfo.repo ?? undefined;
    agent.gitWorktree = gitInfo.worktreePath ?? undefined;
    return {
      pid: proc?.pid ?? null,
      uptime: uptimeMs,
      workingDir: agent.workspaceDir,
      repo: gitInfo.repo,
      branch: gitInfo.branch,
      worktreePath: gitInfo.worktreePath,
      tokensIn: agent.usage?.tokensIn ?? 0,
      tokensOut: agent.usage?.tokensOut ?? 0,
      estimatedCost: Math.round((agent.usage?.estimatedCost ?? 0) * 1e6) / 1e6,
      model: agent.model,
      sessionId: agent.claudeSessionId ?? null,
      lastTurnTokensIn: agent.usage?.lastTurnTokensIn ?? 0,
    };
  }

  /** Return token usage for all agents, keyed by agent ID. */
  getAllUsage(): { agents: Array<{ id: string; name: string; usage: AgentUsage }> } {
    return this.usageTracker.getAllUsage();
  }

  /** Return session logs for an agent in a readable format.
   *  Supports filtering by event type and limiting to the last N entries. */
  async getLogs(id: string, opts?: { types?: string[]; tail?: number }): Promise<{ lines: string[]; total: number }> {
    const { events } = await this.eventPipeline.readPersistedEvents(id);
    if (events.length === 0) return { lines: [], total: 0 };

    const typeFilter = opts?.types;
    let lines: string[] = [];

    for (const event of events) {
      if (typeFilter && !typeFilter.includes(event.type)) continue;

      const line = AgentQueryService.formatLogEvent(event);
      if (line) lines.push(line);
    }

    const total = lines.length;
    if (opts?.tail && opts.tail > 0) {
      lines = lines.slice(-opts.tail);
    }

    return { lines, total };
  }

  /** Format a single event into a readable log line. */
  private static formatLogEvent(event: StreamEvent): string | null {
    switch (event.type) {
      case "user_prompt":
        return `[user] ${event.text}`;
      case "assistant":
        if (event.subtype === "text") return `[assistant] ${event.text}`;
        if (event.subtype === "tool_use") return `[tool_call] ${event.tool}: ${event.content || ""}`;
        if (event.subtype === "tool_result")
          return `[tool_result] ${event.tool}: ${(event.result || event.content || "").toString().slice(0, 500)}`;
        return `[assistant:${event.subtype || "unknown"}] ${event.text || event.content || ""}`;
      case "system":
        return `[system:${event.subtype || ""}] ${event.message || event.text || ""}`;
      case "raw":
        return `[raw] ${event.text}`;
      case "stderr":
        return `[stderr] ${event.text}`;
      case "done":
        return `[done] exit_code=${event.exitCode ?? "unknown"}`;
      case "result":
        return `[result] ${event.text || event.result || ""}`;
      default:
        return `[${event.type}${event.subtype ? `:${event.subtype}` : ""}] ${event.text || event.content || event.message || JSON.stringify(event)}`;
    }
  }
}
