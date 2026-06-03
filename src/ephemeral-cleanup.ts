/**
 * EphemeralCleanup — TTL-based auto-destroy for ephemeral agents.
 *
 * Extracted from src/agents.ts (Phase E PR28).
 * Owns the per-agent ephemeral auto-destroy timers. Receives the shared agents
 * Map plus a callbacks object (the destroy action) via constructor.
 */

import { logger } from "./logger";
import type { Agent, AgentProcess } from "./types";

/** Check whether an agent's retainUntil timestamp is set and still in the future.
 *  Shared by EphemeralCleanup and AgentManager.cleanupExpired. */
export function isAgentRetainedAt(agent: Agent, now: number): boolean {
  if (!agent.retainUntil) return false;
  const ts = new Date(agent.retainUntil).getTime();
  return !Number.isNaN(ts) && now < ts;
}

/** Minimal registry interface for reading agent presence.
 *  The AgentManager `Map<string, AgentProcess>` satisfies this structurally. */
export interface EphemeralRegistry {
  get(id: string): AgentProcess | undefined;
  has(id: string): boolean;
}

/** Callbacks EphemeralCleanup needs from its owner. */
export interface EphemeralCallbacks {
  /** Destroy an agent (and its workspace/process). */
  destroy(id: string): void;
}

export class EphemeralCleanup {
  /** Timers for ephemeral agent auto-destroy. Cleared if the agent receives a new message. */
  private ephemeralTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Grace period before an ephemeral agent is auto-destroyed after going idle (ms).
   *  Gives the delivery system time to forward any pending messages. */
  private static readonly EPHEMERAL_GRACE_MS = 60_000; // 60 seconds

  constructor(
    private readonly agents: EphemeralRegistry,
    private readonly callbacks: EphemeralCallbacks,
  ) {}

  /** Schedule auto-destroy for an ephemeral agent that just went idle.
   *  No-op if the agent is not ephemeral or doesn't exist. */
  schedule(id: string): void {
    const agentProc = this.agents.get(id);
    if (!agentProc?.agent.ephemeral) return;
    // If agent has active retention, delay ephemeral cleanup until retention expires
    // plus the normal grace period, so cleanup fires at the right time.
    const now = Date.now();
    if (isAgentRetainedAt(agentProc.agent, now)) {
      const retainTs = new Date(agentProc.agent.retainUntil as string).getTime();
      const delayMs = retainTs - now + EphemeralCleanup.EPHEMERAL_GRACE_MS;
      this.cancel(id);
      // At most one timer per agent ID is active at any time; cancel()
      // ensures the previous timer is replaced, not accumulated.
      const timer = setTimeout(() => {
        this.ephemeralTimers.delete(id);
        if (!this.agents.has(id)) return; // Agent was destroyed while waiting
        this.schedule(id);
      }, delayMs);
      this.ephemeralTimers.set(id, timer);
      return;
    }

    // Clear any existing timer (e.g. from a previous idle cycle)
    this.cancel(id);

    const timer = setTimeout(() => {
      this.ephemeralTimers.delete(id);
      const ap = this.agents.get(id);
      if (!ap) return; // Already destroyed
      // Only auto-destroy if still idle — if a message restarted it, skip
      if (ap.agent.status !== "idle") return;
      logger.info("[ephemeral] Auto-destroying ephemeral agent after idle grace period", {
        agentId: id,
        agentName: ap.agent.name,
      });
      this.callbacks.destroy(id);
    }, EphemeralCleanup.EPHEMERAL_GRACE_MS);

    this.ephemeralTimers.set(id, timer);
  }

  /** Cancel a pending ephemeral auto-destroy timer (e.g. when a new message arrives). */
  cancel(id: string): void {
    const timer = this.ephemeralTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.ephemeralTimers.delete(id);
    }
  }
}
