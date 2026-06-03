/**
 * AgentWatchdog — detects dead processes, stalled agents, and start timeouts.
 *
 * Extracted from src/agents.ts (Phase E PR28).
 * Receives the shared agents Map plus a callbacks object via constructor.
 * Runs check() on a fixed interval (every 30s) driven by AgentManager.
 */

import { MAX_STALL_COUNT, SOFT_STALL_TIMEOUT_MS, STALL_TIMEOUT_MS, START_TIMEOUT_MS } from "./guardrails";
import { logger } from "./logger";
import { saveAgentState } from "./persistence";
import type { Agent, AgentProcess, StreamEvent } from "./types";

/** Iterable registry of agent processes. The AgentManager Map<string, AgentProcess> satisfies this. */
export interface WatchdogRegistry {
  entries(): IterableIterator<[string, AgentProcess]>;
}

/** Callbacks the watchdog needs from AgentManager without importing it. */
export interface WatchdogCallbacks {
  /** True if an agent has an in-flight lifecycle lock (message/destroy) — skip it. */
  hasLifecycleLock(id: string): boolean;
  /** Schedule an agent_updated SSE notification. */
  scheduleAgentUpdated(id: string, agent: Agent, immediate?: boolean): void;
  /** Persist + broadcast a stream event for an agent. */
  handleEvent(id: string, event: StreamEvent): void;
  /** Notify idle listeners (e.g. so stalled agents can receive queued messages). */
  notifyIdleListeners(id: string): void;
}

export class AgentWatchdog {
  constructor(
    private readonly agents: WatchdogRegistry,
    private readonly callbacks: WatchdogCallbacks,
  ) {}

  /** Detect dead processes, stalled agents, and start timeouts.
   *  Runs every 30s. Skips agents with active lifecycle locks to avoid races. */
  check(): void {
    const now = Date.now();
    for (const [id, agentProc] of this.agents.entries()) {
      const { agent, proc } = agentProc;

      // Skip agents with active lifecycle locks or terminal/transitional states.
      if (this.callbacks.hasLifecycleLock(id)) continue;
      if (
        agent.status === "destroying" ||
        agent.status === "killing" ||
        agent.status === "paused" ||
        agent.status === "disconnected"
      )
        continue;

      // 1. Dead process detection: exitCode is set when the process has exited.
      if (proc && proc.exitCode !== null && agent.status === "running") {
        const exitCode = proc.exitCode;
        logger.warn("[watchdog] Dead process detected", { agentId: id, agentName: agent.name, exitCode });
        agent.status = exitCode === 0 ? "idle" : "error";
        agent.lastActivity = new Date().toISOString();
        saveAgentState(agent);
        this.callbacks.scheduleAgentUpdated(id, agent, true);
        this.callbacks.handleEvent(id, {
          type: "system",
          subtype: "watchdog",
          message: `Process exited unexpectedly (code ${exitCode}). Status changed to ${agent.status}.`,
        });
        if (exitCode === 0) {
          this.callbacks.notifyIdleListeners(id);
        }
        continue;
      }

      // 2. Start timeout: agent stuck in "starting"
      if (agent.status === "starting") {
        const createdAt = new Date(agent.createdAt).getTime();
        if (now - createdAt > START_TIMEOUT_MS) {
          logger.warn("[watchdog] Start timeout", { agentId: id, agentName: agent.name });
          agent.status = "error";
          agent.lastActivity = new Date().toISOString();
          saveAgentState(agent);
          this.callbacks.scheduleAgentUpdated(id, agent, true);
          this.callbacks.handleEvent(id, {
            type: "system",
            subtype: "watchdog",
            message: "Agent failed to start within timeout. Status changed to error.",
          });
        }
        continue;
      }

      // 3. Stall detection: running agent with no output and live process
      if (agent.status === "running" && proc && proc.exitCode === null) {
        const lastActivityTs = new Date(agent.lastActivity).getTime();
        const silentMs = now - lastActivityTs;

        if (silentMs > STALL_TIMEOUT_MS) {
          agentProc.stallCount++;
          if (agentProc.stallCount >= MAX_STALL_COUNT) {
            logger.warn("[watchdog] Agent stalled too many times - marking as error", {
              agentId: id,
              agentName: agent.name,
              stallCount: MAX_STALL_COUNT,
            });
            agent.status = "error";
            saveAgentState(agent);
            this.callbacks.scheduleAgentUpdated(id, agent, true);
            this.callbacks.handleEvent(id, {
              type: "system",
              subtype: "watchdog",
              message: `Agent stalled ${MAX_STALL_COUNT} consecutive times. Marked as error.`,
            });
          } else {
            const silentMinutes = Math.round(silentMs / 60_000);
            logger.warn("[watchdog] Stall detected - no output", {
              agentId: id,
              agentName: agent.name,
              silentMinutes,
              stallCount: agentProc.stallCount,
              maxStallCount: MAX_STALL_COUNT,
            });
            agent.status = "stalled";
            saveAgentState(agent);
            this.callbacks.scheduleAgentUpdated(id, agent, true);
            this.callbacks.handleEvent(id, {
              type: "system",
              subtype: "watchdog",
              message: `No output for ${silentMinutes}+ minutes (stall ${agentProc.stallCount}/${MAX_STALL_COUNT}). Send a message to attempt recovery.`,
            });
            this.callbacks.notifyIdleListeners(id);
          }
        } else if (silentMs > SOFT_STALL_TIMEOUT_MS && !agentProc.softStallNotified) {
          // Soft stall: enable message delivery without changing visible status.
          agentProc.softStallNotified = true;
          logger.info("[watchdog] Soft stall - enabling message delivery", {
            agentId: id,
            agentName: agent.name,
            silentSeconds: Math.round(silentMs / 1000),
          });
          this.callbacks.notifyIdleListeners(id);
        }
      }
    }
  }
}
