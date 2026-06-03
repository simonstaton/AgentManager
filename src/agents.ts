import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AgentWatchdog } from "./agent-watchdog";
import { AGENT_DEDUP_WINDOW_MS, PAUSED_TTL_MS, PROMPT_NAME_MAX_INPUT, PROMPT_NAME_MAX_SLUG } from "./config";
import type { CostTracker } from "./cost-tracker";
import { EphemeralCleanup } from "./ephemeral-cleanup";
import {
  AgentNotFoundError,
  AgentStateError,
  KillSwitchActiveError,
  ResourceLimitError,
  ValidationError,
} from "./errors";
import { EventPipeline } from "./event-pipeline";
import { ALLOWED_MODELS, MAX_AGENT_DEPTH, MAX_AGENTS, MAX_CHILDREN_PER_AGENT, SESSION_TTL_MS } from "./guardrails";
import { logger } from "./logger";
import { DEFAULT_MODEL } from "./models";
import { EVENTS_DIR, loadAllAgentStates, removeAgentState, saveAgentState, writeTombstone } from "./persistence";
import { cleanupAllProcesses, killProcessGroup, ProcessManager } from "./process-manager";
import { getRepoCredentialsForAgents, writeGitCredentialsFile } from "./repo-credentials";
import { StateNotifier } from "./state-notifier";
import { cleanupAgentClaudeData } from "./storage";
import type {
  Agent,
  AgentMetadata,
  AgentProcess,
  AgentStateEvent,
  AgentUsage,
  CreateAgentRequest,
  PromptAttachment,
  StreamEvent,
} from "./types";
import { errorMessage } from "./types";
import { UsageTracker } from "./usage-tracker";
import { WorkspaceManager } from "./workspace-manager";
import { cleanupWorktreesForWorkspace } from "./worktrees";

const execFileAsync = promisify(execFile);

function nowISO(): string {
  return new Date().toISOString();
}

async function gitCmd(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf-8", timeout: 3_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getGitInfo(
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

const NAME_STOP_WORDS = new Set([
  "the",
  "and",
  "but",
  "for",
  "with",
  "from",
  "into",
  "about",
  "after",
  "before",
  "between",
  "out",
  "up",
  "this",
  "that",
  "these",
  "those",
  "its",
  "your",
  "our",
  "their",
  "all",
  "any",
  "some",
  "who",
  "which",
  "what",
  "where",
  "when",
  "how",
  "are",
  "was",
  "were",
  "been",
  "being",
  "have",
  "has",
  "had",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "might",
  "must",
  "shall",
  "need",
  "also",
  "just",
  "then",
  "than",
]);

/**
 * Derives a short, human-readable kebab-case name from the agent's prompt,
 * with a UUID suffix to guarantee uniqueness across agents.
 *
 * Takes the first newline-delimited line of the prompt, strips non-alphanumeric
 * characters, filters stop words, picks the first 3 meaningful words, then
 * appends a 6-char slice of the agent UUID so the result is collision-free.
 *
 * Falls back to `agent-<uuid8>` when the prompt yields fewer than 3 usable chars.
 *
 * Examples:
 *   "Analyze security vulnerabilities in auth" + id "3f2a1b..."
 *     → "analyze-security-vulnerabilities-3f2a1b"
 *   "do it" (all stop/short words) + id "3f2a1b..."
 *     → "agent-3f2a1bxx" (UUID fallback)
 *
 * Exported for unit testing.
 */
export function generateNameFromPrompt(prompt: string, id: string): string {
  // Split on newlines only - dots in version strings and paths must not break the line.
  const firstLine = prompt.split("\n")[0].trim().slice(0, PROMPT_NAME_MAX_INPUT);
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !NAME_STOP_WORDS.has(w));
  const slug = words.slice(0, 3).join("-");
  // UUID suffix guarantees uniqueness even when two agents receive identical prompts.
  if (slug.length < 3) return `agent-${id.slice(0, 8)}`;
  return `${slug}-${id.slice(0, 6)}`.slice(0, PROMPT_NAME_MAX_SLUG);
}

export class AgentManager {
  private agents = new Map<string, AgentProcess>();
  private cleanupInterval: ReturnType<typeof setInterval>;
  private flushInterval: ReturnType<typeof setInterval>;
  private watchdogInterval: ReturnType<typeof setInterval>;
  private notifier: StateNotifier;
  private pendingMessageChecker: ((agentId: string) => boolean) | null = null;
  private writeQueues = new Map<string, Promise<void>>();
  /** Per-agent lifecycle lock to prevent concurrent message/destroy operations.
   *  Each entry is a promise chain - operations queue behind the previous one. */
  private lifecycleLocks = new Map<string, Promise<void>>();
  /** Set of agent IDs currently being delivered to (prevents concurrent delivery). */
  private delivering = new Set<string>();
  /** Track recent agent creations to prevent duplicates from parallel requests.
   *  Key: "parentId:name" or "name", Value: timestamp of creation. */
  private recentCreations = new Map<string, number>();
  /** Set to true by kill switch - blocks create() and message() at the code level. */
  killed = false;
  /** Optional persistent cost tracker (SQLite-backed). */
  private costTracker: CostTracker | null = null;
  private usageTracker: UsageTracker;
  private pipeline: EventPipeline;
  private processManager: ProcessManager;
  private watchdog: AgentWatchdog;
  private ephemeralCleanup: EphemeralCleanup;
  /** Workspace management (directories, symlinks, tokens, env). */
  private workspace = new WorkspaceManager();

  constructor(opts?: { costTracker?: CostTracker }) {
    this.costTracker = opts?.costTracker ?? null;
    this.usageTracker = new UsageTracker(this.agents, this.costTracker);
    this.notifier = new StateNotifier(this.agents);
    this.pipeline = new EventPipeline(this.agents, this.usageTracker, this.writeQueues, (id, agent, immediate) =>
      this.notifier.scheduleAgentUpdated(id, agent, immediate),
    );
    this.ephemeralCleanup = new EphemeralCleanup(this.agents, {
      destroy: (id) => this.destroy(id),
    });
    this.processManager = new ProcessManager(this.agents, this.pipeline, {
      onAgentUpdated: (id, agent, immediate) => this.notifier.scheduleAgentUpdated(id, agent, immediate),
      onIdle: (id) => this.notifyIdleListeners(id),
      onEphemeralIdle: (id) => this.ephemeralCleanup.schedule(id),
    });
    this.watchdog = new AgentWatchdog(this.agents, {
      hasLifecycleLock: (id) => this.lifecycleLocks.has(id),
      scheduleAgentUpdated: (id, agent, immediate) => this.notifier.scheduleAgentUpdated(id, agent, immediate ?? false),
      handleEvent: (id, event) => this.handleEvent(id, event),
      notifyIdleListeners: (id) => this.notifyIdleListeners(id),
    });
    this.workspace.setAgentListProvider(this);
    // Cleanup idle agents every 60s
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60_000);
    // Periodic state flush every 30s (catches lastActivity updates without writing on every poll)
    this.flushInterval = setInterval(() => this.flushAllStates(), 30_000);
    // Watchdog checks every 30s for dead/stalled/stuck-starting agents
    this.watchdogInterval = setInterval(() => this.watchdog.check(), 30_000);
  }

  /** Register a callback that fires when any agent transitions to idle. */
  onIdle(listener: (agentId: string) => void): () => void {
    return this.notifier.onIdle(listener);
  }

  /** Register a callback for agent state change events (SSE push). */
  onAgentState(listener: (event: AgentStateEvent) => void): () => void {
    return this.notifier.onAgentState(listener);
  }

  /** Wire the pending-message checker so cleanupExpired() skips agents with queued work.
   *  Called by message-delivery setup after the message bus is available. */
  setPendingMessageChecker(checker: ((agentId: string) => boolean) | null): void {
    this.pendingMessageChecker = checker;
  }

  /** Restore agents from persisted state files (call on startup). */
  restoreAgents(): void {
    const states = loadAllAgentStates();
    if (states.length === 0) return;

    logger.info(`[restore] Found ${states.length} persisted agent state(s)`);
    for (const agent of states) {
      // Skip if already in memory (shouldn't happen on fresh start, but be safe)
      if (this.agents.has(agent.id)) continue;

      // Recreate workspace directory, symlinks, and token file after container restart
      this.workspace.ensureWorkspace(agent.workspaceDir, agent.name, agent.id);

      // Zombie detection: any agent that had an active or pending process is now
      // disconnected because the process is gone after a container restart.
      // Only the terminal error state is preserved as-is.
      if (agent.status !== "error") {
        agent.status = "disconnected";
        saveAgentState(agent);
      }

      const agentProc: AgentProcess = {
        agent,
        proc: null,
        lineBuffer: "",
        listeners: new Set(),
        seenMessageIds: new Set(),
        processingScheduled: false,
        persistBatch: "",
        persistTimer: null,
        listenerBatch: [],
        stallCount: 0,
        eventBuffer: [],
        eventBufferTotal: 0,
      };
      this.agents.set(agent.id, agentProc);

      // Rehydrate all-time billing on startup for agents with existing usage.
      if (
        (agent.usage?.tokensIn ?? 0) > 0 ||
        (agent.usage?.tokensOut ?? 0) > 0 ||
        (agent.usage?.estimatedCost ?? 0) > 0
      ) {
        this.upsertCostTracker(agentProc);
      }

      // Populate cached git info asynchronously (fire-and-forget)
      this.refreshGitInfo(agent.id).catch(() => {});

      logger.info(`[restore] Restored agent ${agent.name} - status: ${agent.status}`, { agentId: agent.id });
    }
  }

  create(opts: CreateAgentRequest): {
    agent: Agent;
    subscribe: (listener: (event: StreamEvent) => void) => () => void;
  } {
    // Block spawning when kill switch is active
    if (this.killed) {
      throw new KillSwitchActiveError();
    }
    if (this.agents.size >= MAX_AGENTS) {
      throw new ResourceLimitError("agents", this.agents.size, MAX_AGENTS);
    }
    // Enforce immutable depth field and sibling limit
    const parentAgent = opts.parentId ? this.get(opts.parentId) : undefined;
    const depth = (parentAgent?.depth ?? 0) + 1;
    if (depth > MAX_AGENT_DEPTH) {
      throw new ResourceLimitError("depth", depth, MAX_AGENT_DEPTH);
    }
    if (opts.parentId) {
      const siblingCount = this.list().filter((a) => a.parentId === opts.parentId).length;
      if (siblingCount >= MAX_CHILDREN_PER_AGENT) {
        throw new ResourceLimitError("children", siblingCount, MAX_CHILDREN_PER_AGENT);
      }
    }

    const id = randomUUID();
    const name = opts.name || generateNameFromPrompt(opts.prompt, id);

    // Deduplication: reject if an agent with the same name was just created
    // by the same parent within the dedup window. This prevents duplicates
    // from parallel curl requests fired by Claude's parallel tool calls.
    const dedupKey = opts.parentId ? `${opts.parentId}:${name}` : name;
    const dedupNow = Date.now();
    const lastCreated = this.recentCreations.get(dedupKey);
    if (lastCreated && dedupNow - lastCreated < AGENT_DEDUP_WINDOW_MS) {
      const existing = Array.from(this.agents.values()).find(
        (ap) => ap.agent.name === name && ap.agent.parentId === opts.parentId,
      );
      if (existing) {
        throw new ValidationError(
          `Agent "${name}" was already created recently. Use the existing agent (${existing.agent.id.slice(0, 8)}).`,
        );
      }
    }
    this.recentCreations.set(dedupKey, dedupNow);
    // Prune old entries from the dedup map
    for (const [key, ts] of this.recentCreations) {
      if (dedupNow - ts > AGENT_DEDUP_WINDOW_MS) this.recentCreations.delete(key);
    }

    const model = opts.model && ALLOWED_MODELS.includes(opts.model) ? opts.model : DEFAULT_MODEL;
    const workspaceDir = `/tmp/workspace-${id}`;
    this.workspace.ensureWorkspace(workspaceDir, name, id);
    getRepoCredentialsForAgents()
      .then((creds) => writeGitCredentialsFile(workspaceDir, creds))
      .catch((err: unknown) => logger.warn("[agents] Failed to write git credentials", { error: errorMessage(err) }));

    const now = nowISO();
    const agent: Agent = {
      id,
      name,
      status: "starting",
      workspaceDir,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions === true,
      createdAt: now,
      lastActivity: now,
      model,
      role: opts.role,
      capabilities: opts.capabilities,
      parentId: opts.parentId,
      depth, // immutable depth, set at creation time
    };

    let finalPrompt = opts.prompt;
    let attachmentNames: string[] = [];
    if (opts.attachments && opts.attachments.length > 0) {
      const { prefix, names } = this.workspace.saveAttachments(workspaceDir, opts.attachments);
      // Prefix goes first so the LLM reads attached files before the user text.
      finalPrompt = prefix + opts.prompt;
      attachmentNames = names;
    }

    const args = this.processManager.buildClaudeArgs({ ...opts, prompt: finalPrompt }, model);
    const env = this.workspace.buildEnv(id, workspaceDir);

    const agentProc: AgentProcess = {
      agent,
      proc: null,
      lineBuffer: "",
      listeners: new Set(),
      seenMessageIds: new Set(),
      processingScheduled: false,
      persistBatch: "",
      persistTimer: null,
      listenerBatch: [],
      stallCount: 0,
      eventBuffer: [],
      eventBufferTotal: 0,
    };

    this.agents.set(id, agentProc);
    saveAgentState(agent);

    // Persist a user_prompt event so the initial prompt appears in the terminal
    // on reconnect (the UI injects one client-side, but it's lost on refresh).
    // Store original user text + attachment names (not finalPrompt which includes
    // file-path instructions that are only meant for the LLM).
    this.handleEvent(id, {
      type: "user_prompt",
      text: opts.prompt,
      attachmentNames: attachmentNames.length > 0 ? attachmentNames : undefined,
    });

    const proc = this.processManager.spawnProcess(id, agentProc, args, env, workspaceDir);
    agentProc.proc = proc;

    // Update status to running once we get first output
    proc.stdout?.once("data", () => {
      const ap = this.agents.get(id);
      if (ap && ap.agent.status === "starting") {
        ap.agent.status = "running";
        saveAgentState(ap.agent);
      }
    });

    // Populate cached git info asynchronously (fire-and-forget)
    this.refreshGitInfo(id).catch(() => {});

    const userPromptEvent: StreamEvent = {
      type: "user_prompt",
      text: opts.prompt,
      attachmentNames: attachmentNames.length > 0 ? attachmentNames : undefined,
    };
    const subscribe = (listener: (event: StreamEvent) => void) => {
      agentProc.listeners.add(listener);
      // Send the user_prompt as the first event so it appears in the terminal
      // immediately (the handleEvent call above persisted it but fired before
      // this listener was added)
      listener(userPromptEvent);
      // Replay persisted events (skip the first one since we just sent it)
      this.readPersistedEvents(id).then((events) => {
        if (!agentProc.listeners.has(listener)) return;
        for (let i = 1; i < events.length; i++) {
          listener(events[i]);
        }
      });
      return () => {
        agentProc.listeners.delete(listener);
      };
    };

    return { agent, subscribe };
  }

  /** Create multiple agents sequentially from a batch request.
   *  Returns an array of results - one per spec - with either the created agent or an error. */
  createBatch(specs: CreateAgentRequest[]): Array<{ agent: Agent } | { error: string }> {
    const results: Array<{ agent: Agent } | { error: string }> = [];
    for (const spec of specs) {
      try {
        const { agent } = this.create(spec);
        results.push({ agent });
      } catch (err: unknown) {
        results.push({ error: errorMessage(err) });
      }
    }
    return results;
  }

  message(
    id: string,
    prompt: string,
    maxTurns?: number,
    targetSessionId?: string,
    /** Clean user-visible text to display in the terminal (without file-path instructions). */
    displayText?: string,
    /** Names of attachments to show as chips in the terminal. */
    attachmentNames?: string[],
  ): { agent: Agent; subscribe: (listener: (event: StreamEvent) => void) => () => void } {
    // Block messaging when kill switch is active
    if (this.killed) throw new KillSwitchActiveError();
    const agentProc = this.agents.get(id);
    if (!agentProc) throw new AgentNotFoundError(id);
    if (agentProc.agent.status === "killing")
      throw new AgentStateError("Agent is shutting down a previous process, try again shortly");

    // Use targetSessionId if provided, otherwise use the agent's main session.
    // After clearContext(), claudeSessionId is undefined - start a fresh session (no --resume).
    const resumeId = targetSessionId || agentProc.agent.claudeSessionId || undefined;

    const model = agentProc.agent.model;
    const args = this.processManager.buildClaudeArgs(
      {
        prompt,
        maxTurns,
        model,
        dangerouslySkipPermissions: agentProc.agent.dangerouslySkipPermissions === true,
      },
      model,
      resumeId,
    );
    const env = this.workspace.buildEnv(id, agentProc.agent.workspaceDir);

    // Kill old process and await its exit before spawning new one.
    // This prevents event interleaving from the old process's close handler
    // firing after the new process has already started.
    const oldProc = agentProc.proc;
    const killOld: Promise<void> = oldProc ? this.processManager.killAndWait(oldProc, agentProc) : Promise.resolve();

    agentProc.lineBuffer = "";

    // Cancel any pending ephemeral auto-destroy (a new message keeps the agent alive)
    this.ephemeralCleanup.cancel(id);

    // Persist a user_prompt event so the user's message appears in the terminal
    // on reconnect. Use displayText (clean user text) rather than the full prompt
    // which may include file-path instructions intended only for the LLM.
    this.handleEvent(id, {
      type: "user_prompt",
      text: displayText ?? prompt,
      attachmentNames: attachmentNames && attachmentNames.length > 0 ? attachmentNames : undefined,
    });

    // Ensure workspace exists (may have been lost after container restart for restored agents)
    this.workspace.ensureWorkspace(agentProc.agent.workspaceDir, agentProc.agent.name, id);

    // Chain the spawn behind the old process exit via lifecycle lock
    const prevLock = this.lifecycleLocks.get(id) ?? Promise.resolve();
    const spawnAfterKill = prevLock
      .then(() => killOld)
      .then(() => {
        // Re-check agent still exists (may have been destroyed while waiting)
        const ap = this.agents.get(id);
        if (!ap) return;

        const proc = this.processManager.spawnProcess(id, ap, args, env, ap.agent.workspaceDir);

        ap.proc = proc;
        ap.agent.status = "running";
        ap.agent.lastActivity = nowISO();
        saveAgentState(ap.agent);
      });
    const lockPromise = spawnAfterKill.catch((err) => {
      logger.error("[agents] Error spawning agent", { agentId: id, error: errorMessage(err) });
    });
    this.lifecycleLocks.set(id, lockPromise);
    // Clean up the lock entry once the spawn completes so the watchdog can monitor this agent
    lockPromise.then(() => {
      if (this.lifecycleLocks.get(id) === lockPromise) {
        this.lifecycleLocks.delete(id);
      }
    });

    const userPromptEvent: StreamEvent = {
      type: "user_prompt",
      text: displayText ?? prompt,
      attachmentNames: attachmentNames && attachmentNames.length > 0 ? attachmentNames : undefined,
    };
    const subscribe = (listener: (event: StreamEvent) => void) => {
      agentProc.listeners.add(listener);
      // Send the user_prompt as the first event so it appears in the terminal
      // immediately (the handleEvent call above persisted it but fired before
      // this listener was added)
      listener(userPromptEvent);
      return () => {
        agentProc.listeners.delete(listener);
      };
    };

    return { agent: agentProc.agent, subscribe };
  }

  list(): Agent[] {
    return Array.from(this.agents.values()).map((ap) => ap.agent);
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id)?.agent;
  }

  /** Check if an agent can receive a delivered message (idle/restored with a session to resume).
   *  When returning true, atomically sets a delivery lock to prevent concurrent deliveries.
   *  Callers MUST call `deliveryDone(id)` after the message() call completes. */
  canDeliver(id: string): boolean {
    const agentProc = this.agents.get(id);
    if (!agentProc) return false;
    if (this.delivering.has(id)) return false;
    const { status } = agentProc.agent;
    // Only deliver to agents that aren't actively running and have a session to resume
    // (or had their context cleared, in which case a fresh session starts).
    // Stalled agents also receive deliveries to attempt recovery.
    // Disconnected agents are not auto-delivered to - they must be manually destroyed.
    if (status === "idle" || status === "restored" || status === "stalled") {
      this.delivering.add(id);
      return true;
    }
    return false;
  }

  /** Release the delivery lock for an agent after message() has been called. */
  deliveryDone(id: string): void {
    this.delivering.delete(id);
  }

  /** Check if a running agent can be interrupted (busy with a session and a live process). */
  canInterrupt(id: string): boolean {
    const agentProc = this.agents.get(id);
    if (!agentProc) return false;
    return (
      (agentProc.agent.status === "running" || agentProc.agent.status === "starting") &&
      !!agentProc.agent.claudeSessionId &&
      !!agentProc.proc &&
      !agentProc.proc.killed
    );
  }

  touch(id: string): void {
    const agentProc = this.agents.get(id);
    if (agentProc) {
      agentProc.agent.lastActivity = nowISO();
    }
  }

  /** WI-5: Pause an agent by sending SIGSTOP to its process group.
   *  Agents spawn with `detached: true`, giving them their own process group. */
  pause(id: string): boolean {
    const agentProc = this.agents.get(id);
    if (!agentProc) return false;
    const { agent, proc } = agentProc;
    if (agent.status !== "running" && agent.status !== "stalled") return false;
    if (!proc || proc.exitCode !== null || proc.pid == null) return false;

    try {
      process.kill(-proc.pid, "SIGSTOP");
    } catch {
      return false;
    }

    agent.status = "paused";
    agent.lastActivity = nowISO();
    saveAgentState(agent);
    this.handleEvent(id, {
      type: "system",
      subtype: "paused",
      message: "Agent paused via SIGSTOP. Send /resume to continue.",
    });
    return true;
  }

  /** WI-5: Resume a paused agent by sending SIGCONT to its process group.
   *  If SIGCONT fails (e.g. stale connections after long pause), falls back to
   *  killing the process - the next message delivery will respawn via --resume. */
  resume(id: string): boolean {
    const agentProc = this.agents.get(id);
    if (!agentProc) return false;
    const { agent, proc } = agentProc;
    if (agent.status !== "paused") return false;
    if (!proc || proc.pid == null) return false;

    try {
      process.kill(-proc.pid, "SIGCONT");
    } catch {
      // Process group gone - mark as idle so message delivery can respawn
      agent.status = "idle";
      agent.lastActivity = nowISO();
      saveAgentState(agent);
      this.handleEvent(id, {
        type: "system",
        subtype: "resumed",
        message: "Resume failed (process gone). Agent marked idle for respawn.",
      });
      return true;
    }

    // Verify the process is actually alive after SIGCONT - it may have exited
    // while paused (zombie state) and process.kill() won't throw for zombies.
    if (proc.exitCode !== null) {
      agent.status = "idle";
      agent.lastActivity = nowISO();
      saveAgentState(agent);
      this.handleEvent(id, {
        type: "system",
        subtype: "resumed",
        message: "Process exited while paused. Agent marked idle for respawn.",
      });
      return true;
    }

    agent.status = "running";
    agent.lastActivity = nowISO();
    saveAgentState(agent);
    this.handleEvent(id, {
      type: "system",
      subtype: "resumed",
      message: "Agent resumed via SIGCONT.",
    });
    return true;
  }

  /** Clear an agent's context window, resetting session so the next message starts fresh.
   *  Only allowed when the agent is idle or restored. Uses lifecycle locks to prevent races.
   *  Does NOT reset totalTokensSpent (cumulative billing counter). */
  async clearContext(
    id: string,
  ): Promise<{ ok: true; tokensCleared: number } | { ok: false; error: string; status?: string }> {
    const agentProc = this.agents.get(id);
    if (!agentProc) return { ok: false, error: "Agent not found" };

    const { agent } = agentProc;
    const allowedStatuses: string[] = ["idle", "restored"];
    if (!allowedStatuses.includes(agent.status)) {
      return {
        ok: false,
        error: `Agent must be idle to clear context (current: ${agent.status})`,
        status: agent.status,
      };
    }

    const prevLock = this.lifecycleLocks.get(id) ?? Promise.resolve();
    const clearOp = prevLock.then(async () => {
      // Re-check status after acquiring lock (may have changed while waiting)
      if (!allowedStatuses.includes(agent.status)) {
        return { ok: false as const, error: `Agent status changed to ${agent.status}`, status: agent.status };
      }

      const tokensCleared = (agent.usage?.tokensIn ?? 0) + (agent.usage?.tokensOut ?? 0);

      // Backfill cumulative counters for pre-existing agents that lack these fields
      if (agent.usage) {
        if (agent.usage.totalTokensSpent == null) {
          agent.usage.totalTokensSpent = (agent.usage.tokensIn ?? 0) + (agent.usage.tokensOut ?? 0);
        }
        if (agent.usage.totalTokensIn == null) {
          agent.usage.totalTokensIn = agent.usage.tokensIn ?? 0;
        }
        if (agent.usage.totalTokensOut == null) {
          agent.usage.totalTokensOut = agent.usage.tokensOut ?? 0;
        }
      }

      // Reset context window counters (but NOT cumulative billing fields:
      // totalTokensSpent, totalTokensIn, totalTokensOut, estimatedCost)
      if (agent.usage) {
        agent.usage.tokensIn = 0;
        agent.usage.tokensOut = 0;
      }

      // Clear session so next message() spawns a fresh CLI session (no --resume)
      agent.claudeSessionId = undefined;
      agent.lastActivity = nowISO();
      saveAgentState(agent);
      // NOTE: Do NOT call upsertCostTracker here - the session tokens are now 0 but
      // the cost tracker should retain the cumulative billing values. The next usage
      // event will update the cost tracker with accurate cumulative totals.

      // Clear persisted events (old context is irrelevant after reset)
      try {
        await unlink(path.join(EVENTS_DIR, `${id}.jsonl`));
      } catch {
        // File may not exist - that's fine
      }

      // Reset in-memory event state
      agentProc.eventBuffer = [];
      agentProc.eventBufferTotal = 0;
      agentProc.seenMessageIds.clear();

      this.handleEvent(id, {
        type: "system",
        subtype: "context_cleared",
        message: `Context cleared (${tokensCleared} tokens). Next message starts a fresh session.`,
      });

      return { ok: true as const, tokensCleared };
    });

    this.lifecycleLocks.set(
      id,
      clearOp.then(() => {}).catch(() => {}),
    );
    return clearOp;
  }

  async getEvents(id: string): Promise<StreamEvent[]> {
    if (!this.agents.has(id)) return [];
    return this.readPersistedEvents(id);
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
    };
  }

  /** Return token usage for all agents. */
  getAllUsage(): { agents: Array<{ id: string; name: string; usage: AgentUsage }> } {
    return this.usageTracker.getAllUsage();
  }

  /** Reset in-memory usage counters for all tracked agents. */
  resetAllUsage(): void {
    this.usageTracker.resetAllUsage();
  }

  /** Return session logs for an agent in a readable format.
   *  Supports filtering by event type and limiting to the last N entries. */
  async getLogs(id: string, opts?: { types?: string[]; tail?: number }): Promise<{ lines: string[]; total: number }> {
    const events = await this.readPersistedEvents(id);
    if (events.length === 0) return { lines: [], total: 0 };

    const typeFilter = opts?.types;
    let lines: string[] = [];

    for (const event of events) {
      if (typeFilter && !typeFilter.includes(event.type)) continue;

      const line = this.formatLogEvent(event);
      if (line) lines.push(line);
    }

    const total = lines.length;
    if (opts?.tail && opts.tail > 0) {
      lines = lines.slice(-opts.tail);
    }

    return { lines, total };
  }

  /** Format a single event into a readable log line. */
  private formatLogEvent(event: StreamEvent): string | null {
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

  subscribe(id: string, listener: (event: StreamEvent) => void, afterIndex?: number): (() => void) | null {
    const agentProc = this.agents.get(id);
    if (!agentProc) return null;
    agentProc.listeners.add(listener);
    // Replay persisted events (optionally skipping events the client already has)
    this.readPersistedEvents(id).then((events) => {
      if (!agentProc.listeners.has(listener)) return;
      const startIdx = afterIndex != null && afterIndex > 0 ? afterIndex : 0;
      for (let i = startIdx; i < events.length; i++) {
        listener(events[i]);
      }
    });
    return () => {
      agentProc.listeners.delete(listener);
    };
  }

  destroy(id: string): boolean {
    const agentProc = this.agents.get(id);
    if (!agentProc) return false;

    // Wait for any in-flight lifecycle operation (e.g. message() spawn) to finish
    // before tearing down. Chain onto the lifecycle lock so destroy doesn't race
    // with a concurrent message() call.
    const prevLock = this.lifecycleLocks.get(id) ?? Promise.resolve();
    const destroyOp = prevLock.then(() => this.doDestroy(id, agentProc));
    this.lifecycleLocks.set(
      id,
      destroyOp.catch((err) => {
        logger.error("[agents] Error destroying agent", { agentId: id, error: errorMessage(err) });
      }),
    );

    // Mark agent as destroying immediately so canDeliver/canInterrupt return false
    agentProc.agent.status = "destroying";

    // Remove from in-memory map immediately so no other code path
    // (flush interval, close handler) can re-save this agent's state.
    this.agents.delete(id);
    this.delivering.delete(id);

    return true;
  }

  /** Internal destroy implementation - runs after lifecycle lock is released. */
  private async doDestroy(id: string, agentProc: AgentProcess): Promise<void> {
    // Finalize cost record in SQLite before cleanup - the data was already
    // upserted independently of the agent map, so this just sets closedAt.
    if (this.costTracker) {
      this.costTracker.finalize(id);
    }

    // Flush any pending event batches before destroy so no events are lost
    this.flushEventBatch(id, agentProc);

    // Remove process handlers BEFORE killing to prevent the close handler from
    // re-saving agent state after we delete it (race condition that caused
    // destroyed agents to be restored on server restart).
    const proc = agentProc.proc;
    if (proc) {
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.removeAllListeners("close");
      if (!proc.killed) {
        killProcessGroup(proc);
      }
    }

    for (const listener of agentProc.listeners) {
      try {
        listener({ type: "destroyed" });
      } catch (err: unknown) {
        logger.warn("[agents] Listener error during destroy", { error: errorMessage(err) });
      }
    }
    agentProc.listeners.clear();

    await cleanupWorktreesForWorkspace(agentProc.agent.workspaceDir);

    try {
      await rm(agentProc.agent.workspaceDir, { recursive: true, force: true });
    } catch (err: unknown) {
      logger.warn("[agents] Failed to remove workspace", { error: errorMessage(err), agentId: id });
    }
    await cleanupAgentClaudeData(agentProc.agent.workspaceDir);
    try {
      await unlink(path.join(EVENTS_DIR, `${id}.jsonl`));
    } catch (err: unknown) {
      logger.warn("[agents] Failed to remove event file", { error: errorMessage(err), agentId: id });
    }
    await removeAgentState(id);
    this.writeQueues.delete(id);
    this.lifecycleLocks.delete(id);
  }

  destroyAll(): void {
    for (const id of [...this.agents.keys()]) {
      this.destroy(id);
    }
  }

  /**
   * Nuclear emergency shutdown - called by the kill switch.
   * Unlike destroyAll(), this:
   *   1. Sets killed flag immediately (blocks create/message at code level)
   *   2. Clears all message bus listeners (prevents auto-delivery from re-triggering agents)
   *   3. SIGKILLs all tracked processes immediately (no graceful SIGTERM)
   *   4. Kills ALL non-init processes (not just claude - catches bash, node, curl, git, etc.)
   *   5. Deletes ALL state files so agents are not restored on restart
   *   6. Writes a tombstone file so loadAllAgentStates() skips restoration even if delete failed
   *   7. Schedules a second pass at +500ms to catch processes spawned mid-kill
   */
  emergencyDestroyAll(): void {
    this.killed = true;
    clearInterval(this.cleanupInterval);
    clearInterval(this.flushInterval);
    clearInterval(this.watchdogInterval);

    logger.info("[kill-switch] emergencyDestroyAll - starting nuclear shutdown");

    // Clear all idle listeners to prevent auto-delivery from re-triggering agent runs
    this.notifier.clearIdleListeners();

    // SIGKILL all tracked processes immediately
    for (const [id, agentProc] of this.agents) {
      // Clear WI-1 batch timers and ring buffer
      if (agentProc.persistTimer) clearTimeout(agentProc.persistTimer);
      agentProc.persistTimer = null;
      agentProc.persistBatch = "";
      agentProc.listenerBatch = [];
      agentProc.eventBuffer = [];
      agentProc.eventBufferTotal = 0;

      const proc = agentProc.proc;
      if (proc) {
        proc.stdout?.removeAllListeners();
        proc.stderr?.removeAllListeners();
        proc.removeAllListeners("close");
        if (!proc.killed && proc.pid != null) {
          try {
            process.kill(-proc.pid, "SIGKILL");
          } catch {
            try {
              process.kill(proc.pid, "SIGKILL");
            } catch {
              /* already dead */
            }
          }
        }
      }
      agentProc.listeners.clear();

      // Fire-and-forget cleanup - emergencyDestroyAll is synchronous by design
      // (nuclear kill path) so we don't await, but must use .catch() since
      // removeAgentState is async and try/catch won't catch promise rejections.
      removeAgentState(id).catch((err) => {
        logger.error("[agents] Failed to remove state for agent", { agentId: id, error: errorMessage(err) });
      });
      unlink(path.join(EVENTS_DIR, `${id}.jsonl`)).catch((err) => {
        logger.error("[agents] Failed to remove events file for agent", { agentId: id, error: errorMessage(err) });
      });
    }

    // Collect agent root PIDs before clearing so cleanupAllProcesses only kills their descendants
    const agentRootPids = Array.from(this.agents.values())
      .map((a) => a.proc?.pid)
      .filter((p): p is number => p != null && p > 0);

    this.agents.clear();
    this.writeQueues.clear();
    this.lifecycleLocks.clear();
    this.delivering.clear();

    // Write tombstone so loadAllAgentStates() skips restoration on next startup
    writeTombstone();

    // Kill only agent descendants (bash/node/curl/git spawned by agents), not unrelated processes
    cleanupAllProcesses(agentRootPids);

    // Second pass at +500ms to catch anything spawned mid-kill
    setTimeout(() => {
      cleanupAllProcesses(agentRootPids);
      logger.info("[kill-switch] Second cleanup pass complete");
    }, 500).unref();

    logger.info("[kill-switch] emergencyDestroyAll complete");
  }

  /** Graceful shutdown: flush state and kill processes, but preserve state files for restore. */
  dispose(): void {
    clearInterval(this.cleanupInterval);
    clearInterval(this.flushInterval);
    clearInterval(this.watchdogInterval);
    this.flushAllStates();
    for (const [id, agentProc] of this.agents) {
      // Flush any pending event batches before shutdown
      this.flushEventBatch(id, agentProc);
      if (agentProc.proc && !agentProc.proc.killed) {
        killProcessGroup(agentProc.proc);
      }
      agentProc.listeners.clear();
    }
    this.writeQueues.clear();
    this.agents.clear();
  }

  /** Returns the set of workspace directories for all active agents. */
  getActiveWorkspaceDirs(): Set<string> {
    const dirs = new Set<string>();
    for (const agentProc of this.agents.values()) {
      dirs.add(agentProc.agent.workspaceDir);
    }
    return dirs;
  }

  /** Handle a single event: extract metadata immediately, batch persistence
   *  and listener notification. Metadata (session_id, usage) is processed
   *  synchronously since it affects agent state. Disk writes and listener
   *  notifications are coalesced into 16 ms batches to reduce I/O calls and
   *  SSE write pressure. */
  private handleEvent(id: string, event: StreamEvent): void {
    this.pipeline.handleEvent(id, event);
  }

  private upsertCostTracker(agentProc: AgentProcess): void {
    this.usageTracker.upsertCostTracker(agentProc);
  }

  private flushEventBatch(id: string, agentProc: AgentProcess): void {
    this.pipeline.flushEventBatch(id, agentProc);
  }

  private readEventBuffer(agentProc: AgentProcess): StreamEvent[] {
    return this.pipeline.readEventBuffer(agentProc);
  }

  private async readPersistedEvents(id: string): Promise<StreamEvent[]> {
    const { events } = await this.pipeline.readPersistedEvents(id);
    return events;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, agentProc] of [...this.agents]) {
      const lastActivity = new Date(agentProc.agent.lastActivity).getTime();
      // Paused agents get an extended 24-hour TTL instead of indefinite exemption
      if (agentProc.agent.status === "paused") {
        if (now - lastActivity > PAUSED_TTL_MS) {
          logger.info("Cleaning up paused agent (exceeded 24h TTL)", { agentId: id });
          this.destroy(id);
        }
        continue;
      }
      if (now - lastActivity > SESSION_TTL_MS) {
        // Skip idle child agents that still have messages queued for delivery
        if (this.pendingMessageChecker?.(id)) continue;
        logger.info("Cleaning up expired agent", { agentId: id });
        this.destroy(id);
      }
    }
  }

  private notifyIdleListeners(id: string): void {
    this.notifier.notifyIdleListeners(id);
  }

  /** Flush all agent states to disk. */
  private flushAllStates(): void {
    for (const agentProc of this.agents.values()) {
      saveAgentState(agentProc.agent);
    }
    this.pipeline.truncateEventFiles(this.agents.keys());
  }

  /** Save attachments to the agent workspace.
   *  Delegates to WorkspaceManager. Returns `{ prefix, names }`. */
  saveAttachments(workspaceDir: string, attachments: PromptAttachment[]): { prefix: string; names: string[] } {
    return this.workspace.saveAttachments(workspaceDir, attachments);
  }

  /** Refresh auth token files for all active agents. Called periodically (every 60 min)
   *  to ensure tokens never expire (4h TTL). Delegates to WorkspaceManager. */
  refreshAllAgentTokens(): void {
    this.workspace.refreshAllAgentTokens(this.agents, this.killed);
  }
}
