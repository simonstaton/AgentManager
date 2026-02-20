import type { TaskGraph, TaskGraphEvent, TaskMessage, TaskNode, TaskResult } from "./task-graph";
import type { Agent } from "./types";

export interface OrchestratorConfig {
  /** Maximum times to retry a failed task before escalating. */
  maxRetries: number;
  /** How often (ms) the orchestrator checks for assignable tasks. */
  pollIntervalMs: number;
  /** Maximum tasks to assign in a single poll cycle. */
  maxAssignmentsPerCycle: number;
  /** Minimum capability score for an agent to be considered for a task. */
  minCapabilityScore: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxRetries: 3,
  pollIntervalMs: 5_000,
  maxAssignmentsPerCycle: 5,
  minCapabilityScore: 0.1,
};

export interface AssignmentDecision {
  taskId: string;
  agentId: string;
  score: number;
  reason: string;
}

export interface OrchestratorEvent {
  type: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface AgentProvider {
  /** Get all available agents (idle or restored, with a session). */
  getAvailableAgents(): Agent[];
  /** Get a specific agent by ID. */
  getAgent(id: string): Agent | undefined;
}

export interface MessageSender {
  /** Send a task assignment message to an agent via the message bus. */
  sendTaskMessage(agentId: string, message: TaskMessage): void;
  /** Send a notification to an agent. */
  sendNotification(agentId: string, content: string): void;
}

/** Maximum length for strings included in log details. */
const MAX_LOG_STRING_LENGTH = 500;

function truncate(s: string | undefined | null, max = MAX_LOG_STRING_LENGTH): string | undefined | null {
  if (!s || s.length <= max) return s;
  return `${s.slice(0, max)}... [truncated]`;
}

export class Orchestrator {
  private taskGraph: TaskGraph;
  private agentProvider: AgentProvider;
  private messageSender: MessageSender;
  private config: OrchestratorConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private eventLog: OrchestratorEvent[] = [];
  private static readonly MAX_EVENT_LOG = 1000;
  private unsubscribeTaskGraph: (() => void) | null = null;

  constructor(
    taskGraph: TaskGraph,
    agentProvider: AgentProvider,
    messageSender: MessageSender,
    config?: Partial<OrchestratorConfig>,
  ) {
    this.taskGraph = taskGraph;
    this.agentProvider = agentProvider;
    this.messageSender = messageSender;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Subscribe to task graph events for reactive handling (always active)
    this.unsubscribeTaskGraph = this.taskGraph.subscribe((event) => this.handleTaskEvent(event));
  }

  /** Start the orchestrator's Plan-Execute-Observe loop. */
  start(): void {
    if (this.pollTimer) return;

    // Start periodic poll for task assignment
    this.pollTimer = setInterval(() => this.assignmentCycle(), this.config.pollIntervalMs);
    this.pollTimer.unref();

    this.log("orchestrator_started", { pollIntervalMs: this.config.pollIntervalMs });
  }

  /** Stop the orchestrator loop. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.unsubscribeTaskGraph) {
      this.unsubscribeTaskGraph();
      this.unsubscribeTaskGraph = null;
    }
    this.log("orchestrator_stopped", {});
  }

  /** Decompose a high-level goal into a DAG of tasks. Returns the created tasks. */
  decomposeGoal(opts: {
    goal: string;
    subtasks: Array<{
      title: string;
      description?: string;
      requiredCapabilities?: string[];
      dependsOnIndices?: number[];
      priority?: 0 | 1 | 2 | 3 | 4;
      input?: Record<string, unknown>;
      expectedOutput?: Record<string, unknown>;
      acceptanceCriteria?: string;
      timeoutMs?: number;
    }>;
    parentTaskId?: string;
  }): TaskNode[] {
    // Wrap entire decomposition in a transaction for atomicity
    return this.taskGraph.runInTransaction(() => {
      const createdTasks: TaskNode[] = [];

      // First pass: create all tasks without dependencies
      for (const sub of opts.subtasks) {
        const task = this.taskGraph.createTask({
          title: sub.title,
          description: sub.description,
          requiredCapabilities: sub.requiredCapabilities,
          priority: sub.priority,
          parentTaskId: opts.parentTaskId,
          input: sub.input,
          expectedOutput: sub.expectedOutput,
          acceptanceCriteria: sub.acceptanceCriteria,
          timeoutMs: sub.timeoutMs,
          maxRetries: this.config.maxRetries,
        });
        createdTasks.push(task);
      }

      // Second pass: wire up dependencies using addDependencies (no delete-recreate)
      for (let i = 0; i < opts.subtasks.length; i++) {
        const sub = opts.subtasks[i];
        if (sub.dependsOnIndices && sub.dependsOnIndices.length > 0) {
          const depIds = sub.dependsOnIndices
            .filter((idx) => idx >= 0 && idx < createdTasks.length)
            .map((idx) => createdTasks[idx].id);

          if (depIds.length > 0) {
            this.taskGraph.addDependencies(createdTasks[i].id, depIds);
            // Re-fetch to get updated status (may now be blocked)
            const updated = this.taskGraph.getTask(createdTasks[i].id);
            if (updated) createdTasks[i] = updated;
          }
        }
      }

      this.log("goal_decomposed", {
        goal: truncate(opts.goal),
        taskCount: createdTasks.length,
        taskIds: createdTasks.map((t) => t.id),
      });

      // Trigger immediate assignment cycle
      this.assignmentCycle();

      return createdTasks;
    });
  }

  /** Submit a task result from an agent. Validates and processes the outcome. */
  submitResult(result: TaskResult): {
    accepted: boolean;
    unblockedTasks: TaskNode[];
    error?: string;
  } {
    const task = this.taskGraph.getTask(result.taskId);
    if (!task) {
      return { accepted: false, unblockedTasks: [], error: "Task not found" };
    }

    if (task.status !== "running" && task.status !== "assigned") {
      return {
        accepted: false,
        unblockedTasks: [],
        error: `Task is in ${task.status} state, expected running or assigned`,
      };
    }

    if (result.status === "completed") {
      const { success, unblockedTasks } = this.taskGraph.completeTask(result.taskId, task.version);
      if (!success) {
        return { accepted: false, unblockedTasks: [], error: "Version conflict - task was modified concurrently" };
      }

      // Update agent capability stats
      if (task.ownerAgentId) {
        this.taskGraph.recordTaskOutcome(task.ownerAgentId, task.requiredCapabilities, true);
      }

      this.log("result_accepted", {
        taskId: task.id,
        agentId: task.ownerAgentId,
        confidence: result.confidence,
        durationMs: result.durationMs,
        unblockedCount: unblockedTasks.length,
      });

      // Auto-assign newly unblocked tasks
      for (const unblocked of unblockedTasks) {
        this.tryAssignTask(unblocked);
      }

      return { accepted: true, unblockedTasks };
    }

    // Handle failure
    const { success, blockedTasks, canRetry } = this.taskGraph.failTask(
      result.taskId,
      task.version,
      result.errorMessage ?? "Unknown error",
    );

    if (!success) {
      return { accepted: false, unblockedTasks: [], error: "Version conflict" };
    }

    // Update agent capability stats
    if (task.ownerAgentId) {
      this.taskGraph.recordTaskOutcome(task.ownerAgentId, task.requiredCapabilities, false);
    }

    this.log("result_failed", {
      taskId: task.id,
      agentId: task.ownerAgentId,
      errorMessage: truncate(result.errorMessage),
      canRetry,
      blockedCount: blockedTasks.length,
    });

    // Recovery is handled by the task graph event listener (handleTaskEvent).
    // We only need to handle the escalation case (no retries left) here.
    if (!canRetry) {
      for (const blocked of blockedTasks) {
        if (blocked.ownerAgentId) {
          this.messageSender.sendNotification(
            blocked.ownerAgentId,
            `Task "${blocked.title}" is blocked because dependency "${task.title}" failed after ${task.maxRetries} retries: ${result.errorMessage ?? "unknown error"}`,
          );
        }
      }
    }

    return { accepted: true, unblockedTasks: [] };
  }

  /** Run a single assignment cycle: find unassigned tasks and match them to agents. */
  assignmentCycle(): AssignmentDecision[] {
    const decisions: AssignmentDecision[] = [];
    const pendingTasks = this.taskGraph.queryTasks({
      status: "pending",
      unblocked: true,
      unowned: true,
      limit: this.config.maxAssignmentsPerCycle,
    });

    if (pendingTasks.length === 0) return decisions;

    const availableAgents = this.agentProvider.getAvailableAgents();
    if (availableAgents.length === 0) return decisions;

    // Track which agents we've assigned in this cycle to avoid double-assignment
    const assignedAgents = new Set<string>();

    for (const task of pendingTasks) {
      const decision = this.selectBestAgent(task, availableAgents, assignedAgents);
      if (!decision) continue;

      const assigned = this.taskGraph.assignTask(task.id, decision.agentId, task.version);
      if (!assigned) continue;

      assignedAgents.add(decision.agentId);
      decisions.push(decision);

      // Send task assignment message
      const taskMessage: TaskMessage = {
        taskId: task.id,
        type: "assignment",
        input: task.input,
        expectedOutput: task.expectedOutput,
        successCriteria: task.acceptanceCriteria,
        timeoutMs: task.timeoutMs,
      };
      this.messageSender.sendTaskMessage(decision.agentId, taskMessage);

      this.log("task_assigned", {
        taskId: task.id,
        agentId: decision.agentId,
        score: decision.score,
        reason: decision.reason,
      });
    }

    return decisions;
  }

  /** Get the orchestrator's event log (most recent events). */
  getEventLog(limit = 50): OrchestratorEvent[] {
    const safeLimit = Math.min(Math.max(limit, 1), Orchestrator.MAX_EVENT_LOG);
    return this.eventLog.slice(-safeLimit);
  }

  /** Get a summary of the current orchestrator state. */
  getStatus(): {
    running: boolean;
    taskSummary: ReturnType<TaskGraph["getSummary"]>;
    recentEvents: OrchestratorEvent[];
    agentProfiles: Array<{
      agentId: string;
      totalCompleted: number;
      totalFailed: number;
      topCapabilities: Array<{ capability: string; successRate: number }>;
    }>;
  } {
    const profiles = this.taskGraph.getAllCapabilityProfiles().map((p) => ({
      agentId: p.agentId,
      totalCompleted: p.totalCompleted,
      totalFailed: p.totalFailed,
      topCapabilities: Object.entries(p.successRate)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([capability, successRate]) => ({ capability, successRate })),
    }));

    return {
      running: this.pollTimer !== null,
      taskSummary: this.taskGraph.getSummary(),
      recentEvents: this.eventLog.slice(-20),
      agentProfiles: profiles,
    };
  }

  /** React to task graph events. */
  private handleTaskEvent(event: TaskGraphEvent): void {
    switch (event.type) {
      case "task_unblocked":
        // Try to assign newly unblocked tasks
        this.tryAssignTask(event.task);
        break;

      case "task_failed":
        if (event.canRetry) {
          // Refresh the task to get latest state (including updated retryCount)
          const fresh = this.taskGraph.getTask(event.task.id);
          if (fresh) this.attemptRecovery(fresh);
        }
        break;
    }
  }

  /** Try to assign a single task to the best available agent. */
  private tryAssignTask(task: TaskNode): void {
    const availableAgents = this.agentProvider.getAvailableAgents();
    if (availableAgents.length === 0) return;

    const decision = this.selectBestAgent(task, availableAgents, new Set());
    if (!decision) return;

    // Re-fetch task to get latest version
    const fresh = this.taskGraph.getTask(task.id);
    if (!fresh || fresh.status !== "pending") return;

    const assigned = this.taskGraph.assignTask(fresh.id, decision.agentId, fresh.version);
    if (!assigned) return;

    const taskMessage: TaskMessage = {
      taskId: fresh.id,
      type: "assignment",
      input: fresh.input,
      expectedOutput: fresh.expectedOutput,
      successCriteria: fresh.acceptanceCriteria,
      timeoutMs: fresh.timeoutMs,
    };
    this.messageSender.sendTaskMessage(decision.agentId, taskMessage);

    this.log("task_auto_assigned", {
      taskId: fresh.id,
      agentId: decision.agentId,
      score: decision.score,
      reason: decision.reason,
    });
  }

  /** Select the best agent for a task based on capability scoring. */
  private selectBestAgent(
    task: TaskNode,
    availableAgents: Agent[],
    excludeAgents: Set<string>,
  ): AssignmentDecision | null {
    let bestAgent: Agent | null = null;
    let bestScore = this.config.minCapabilityScore;
    let bestReason = "";

    for (const agent of availableAgents) {
      if (excludeAgents.has(agent.id)) continue;
      if (agent.status !== "idle" && agent.status !== "restored") continue;

      const score = this.taskGraph.scoreAgent(agent.id, task);

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;

        if (task.requiredCapabilities.length === 0) {
          bestReason = `Best available agent (reliability score: ${score.toFixed(2)})`;
        } else {
          bestReason = `Capability match score ${score.toFixed(2)} for [${task.requiredCapabilities.join(", ")}]`;
        }
      }
    }

    // If no agent meets the minimum score, fall back to any available agent
    if (!bestAgent && availableAgents.length > 0) {
      const fallback = availableAgents.find(
        (a) => !excludeAgents.has(a.id) && (a.status === "idle" || a.status === "restored"),
      );
      if (fallback) {
        bestAgent = fallback;
        bestScore = 0.1;
        bestReason = "Fallback assignment (no capable agents available)";
      }
    }

    if (!bestAgent) return null;

    return {
      taskId: task.id,
      agentId: bestAgent.id,
      score: bestScore,
      reason: bestReason,
    };
  }

  /** Attempt to recover a failed task: retry with same agent, or reassign. */
  private attemptRecovery(task: TaskNode): void {
    // Try a different agent first
    const availableAgents = this.agentProvider.getAvailableAgents();
    const alternateAgent = availableAgents.find(
      (a) => a.id !== task.ownerAgentId && (a.status === "idle" || a.status === "restored"),
    );

    if (alternateAgent) {
      const retried = this.taskGraph.retryTask(task.id, alternateAgent.id);
      if (retried) {
        const taskMessage: TaskMessage = {
          taskId: task.id,
          type: "reassignment",
          input: task.input,
          expectedOutput: task.expectedOutput,
          successCriteria: task.acceptanceCriteria,
          timeoutMs: task.timeoutMs,
        };
        this.messageSender.sendTaskMessage(alternateAgent.id, taskMessage);

        this.log("task_reassigned", {
          taskId: task.id,
          fromAgent: task.ownerAgentId,
          toAgent: alternateAgent.id,
          retryCount: task.retryCount,
        });
        return;
      }
    }

    // Fall back to retrying with the same agent
    const retried = this.taskGraph.retryTask(task.id, task.ownerAgentId ?? undefined);
    if (retried) {
      this.log("task_retry_same_agent", {
        taskId: task.id,
        agentId: task.ownerAgentId,
        retryCount: task.retryCount,
      });
    } else {
      this.log("task_recovery_exhausted", {
        taskId: task.id,
        agentId: task.ownerAgentId,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
      });
    }
  }

  private log(type: string, details: Record<string, unknown>): void {
    const event: OrchestratorEvent = {
      type,
      timestamp: new Date().toISOString(),
      details,
    };
    this.eventLog.push(event);
    if (this.eventLog.length > Orchestrator.MAX_EVENT_LOG) {
      this.eventLog = this.eventLog.slice(-Orchestrator.MAX_EVENT_LOG);
    }
    console.log(`[orchestrator] ${type}:`, JSON.stringify(details));
  }
}
