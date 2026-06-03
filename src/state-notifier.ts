import { logger } from "./logger";
import type { Agent, AgentProcess, AgentStateEvent } from "./types";
import { errorMessage } from "./types";

/** Minimal registry interface for reading agent presence. The AgentManager
 *  `Map<string, AgentProcess>` satisfies this structurally. */
export interface NotifierRegistry {
  get(id: string): AgentProcess | undefined;
}

export class StateNotifier {
  private idleListeners = new Set<(agentId: string) => void>();
  private agentStateListeners = new Set<(event: AgentStateEvent) => void>();
  private stateNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly agents: NotifierRegistry) {}

  /** Register a callback that fires when any agent transitions to idle.
   *  Returns an unsubscribe function. */
  onIdle(listener: (agentId: string) => void): () => void {
    this.idleListeners.add(listener);
    return () => {
      this.idleListeners.delete(listener);
    };
  }

  /** Register a callback for agent state change events (SSE push). Returns an unsubscribe function. */
  onAgentState(listener: (event: AgentStateEvent) => void): () => void {
    this.agentStateListeners.add(listener);
    return () => this.agentStateListeners.delete(listener);
  }

  /** Broadcast an agent state change event to all registered SSE listeners. */
  notifyAgentState(event: AgentStateEvent): void {
    for (const listener of this.agentStateListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.warn("[agents] agentState listener error", { error: errorMessage(err) });
      }
    }
  }

  /** Schedule an agent_updated notification.
   *  immediate=true: fires synchronously (status transitions).
   *  immediate=false: debounced 1s (usage-only updates). */
  scheduleAgentUpdated(id: string, agent: Agent, immediate = false): void {
    if (immediate) {
      const timer = this.stateNotifyTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.stateNotifyTimers.delete(id);
      }
      this.notifyAgentState({ type: "agent_updated", agent: { ...agent } });
      return;
    }
    if (!this.stateNotifyTimers.has(id)) {
      this.stateNotifyTimers.set(
        id,
        setTimeout(() => {
          this.stateNotifyTimers.delete(id);
          const ap = this.agents.get(id);
          if (ap) this.notifyAgentState({ type: "agent_updated", agent: { ...ap.agent } });
        }, 1000),
      );
    }
  }

  /** Notify all idle listeners for an agent. */
  notifyIdleListeners(id: string): void {
    for (const listener of this.idleListeners) {
      try {
        listener(id);
      } catch (err: unknown) {
        logger.warn("[agents] Idle listener error", { error: errorMessage(err) });
      }
    }
  }

  /** Cancel any pending debounced agent_updated timer for an agent (used on destroy). */
  cancelTimer(id: string): void {
    const timer = this.stateNotifyTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.stateNotifyTimers.delete(id);
    }
  }

  /** Clear all idle listeners (used by the kill switch to stop auto-delivery re-triggering). */
  clearIdleListeners(): void {
    this.idleListeners.clear();
  }
}
