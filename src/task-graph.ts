import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type TaskStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "blocked" | "cancelled";

export type TaskPriority = 0 | 1 | 2 | 3 | 4; // 0=none, 1=urgent, 2=high, 3=normal, 4=low

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  ownerAgentId: string | null;
  /** Parent goal/task that spawned this task. */
  parentTaskId: string | null;
  /** Typed input data for the task. */
  input: Record<string, unknown> | null;
  /** Schema describing expected output shape. */
  expectedOutput: Record<string, unknown> | null;
  /** Human-readable acceptance criteria. */
  acceptanceCriteria: string | null;
  /** Capability tags required to handle this task. */
  requiredCapabilities: string[];
  /** IDs of tasks that must complete before this task can start. */
  dependsOn: string[];
  /** Optimistic lock version - incremented on every write. */
  version: number;
  /** Number of times this task has been retried after failure. */
  retryCount: number;
  maxRetries: number;
  /** Timeout in ms for task execution. */
  timeoutMs: number | null;
  /** Error message if status is 'failed'. */
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Schema for a structured task result returned by an agent. */
export interface TaskResult {
  taskId: string;
  status: "completed" | "failed";
  output: Record<string, unknown> | null;
  confidence: "high" | "medium" | "low";
  durationMs: number;
  errorMessage?: string;
}

/** Schema for a structured task assignment message. */
export interface TaskMessage {
  taskId: string;
  type: "assignment" | "reassignment" | "cancellation" | "blocked_notification" | "unblocked_notification";
  input: Record<string, unknown> | null;
  expectedOutput: Record<string, unknown> | null;
  successCriteria: string | null;
  timeoutMs: number | null;
}

/** Options for querying tasks. */
export interface TaskQuery {
  status?: TaskStatus | TaskStatus[];
  ownerAgentId?: string;
  parentTaskId?: string;
  unblocked?: boolean;
  unowned?: boolean;
  requiredCapability?: string;
  limit?: number;
}

/** Agent capability profile for routing decisions. */
export interface AgentCapabilityProfile {
  agentId: string;
  capabilities: Record<string, number>; // capability tag -> confidence 0-1
  successRate: Record<string, number>; // capability tag -> success rate 0-1
  totalCompleted: number;
  totalFailed: number;
  updatedAt: string;
}

const PERSISTENT_DIR = "/persistent/task-graph";
const TMP_DIR = "/tmp/task-graph-data";
const DB_DIR = existsSync("/persistent") ? PERSISTENT_DIR : TMP_DIR;
const DB_PATH = path.join(DB_DIR, "task-graph.db");

/** Maximum active (non-completed, non-cancelled) tasks allowed. */
export const MAX_TASKS = 10_000;
/** Maximum dependencies per task. */
export const MAX_DEPENDENCIES = 100;
/** Maximum retry limit a task can specify. */
export const MAX_RETRIES_LIMIT = 10;
/** Maximum timeout a task can specify (1 hour). */
export const MAX_TIMEOUT_MS = 3_600_000;

export class TaskGraph {
  private db: Database.Database;

  // Prepared statements
  private insertStmt: Database.Statement;
  private updateStatusStmt: Database.Statement;
  private assignStmt: Database.Statement;
  private completeStmt: Database.Statement;
  private failStmt: Database.Statement;
  private getStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private insertDepStmt: Database.Statement;
  private getDepStmt: Database.Statement;
  private getDependentsStmt: Database.Statement;
  private cancelStmt: Database.Statement;
  private retryStmt: Database.Statement;
  private unblockStmt: Database.Statement;
  private blockStmt: Database.Statement;
  private setBlockedStmt: Database.Statement;
  private activeCountStmt: Database.Statement;
  private upsertCapStmt: Database.Statement;
  private getCapStmt: Database.Statement;
  private getAllCapsStmt: Database.Statement;
  private listeners = new Set<(event: TaskGraphEvent) => void>();

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? DB_PATH;
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 3,
        owner_agent_id TEXT,
        parent_task_id TEXT,
        input TEXT,
        expected_output TEXT,
        acceptance_criteria TEXT,
        required_capabilities TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        timeout_ms INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL,
        depends_on_id TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_capabilities (
        agent_id TEXT PRIMARY KEY,
        capabilities TEXT NOT NULL DEFAULT '{}',
        success_rate TEXT NOT NULL DEFAULT '{}',
        total_completed INTEGER NOT NULL DEFAULT 0,
        total_failed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `);

    // Create indexes for common queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_agent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_deps_depends_on ON task_dependencies(depends_on_id);
    `);

    // Prepare statements
    this.insertStmt = this.db.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, owner_agent_id, parent_task_id,
                         input, expected_output, acceptance_criteria, required_capabilities,
                         version, retry_count, max_retries, timeout_ms, created_at, updated_at)
      VALUES (@id, @title, @description, @status, @priority, @ownerAgentId, @parentTaskId,
              @input, @expectedOutput, @acceptanceCriteria, @requiredCapabilities,
              1, 0, @maxRetries, @timeoutMs, @createdAt, @updatedAt)
    `);

    this.updateStatusStmt = this.db.prepare(`
      UPDATE tasks SET status = @status, version = version + 1, updated_at = @updatedAt
      WHERE id = @id AND version = @expectedVersion
    `);

    this.assignStmt = this.db.prepare(`
      UPDATE tasks SET owner_agent_id = @ownerAgentId, status = 'assigned',
                       version = version + 1, updated_at = @updatedAt
      WHERE id = @id AND version = @expectedVersion AND status IN ('pending', 'failed')
    `);

    this.completeStmt = this.db.prepare(`
      UPDATE tasks SET status = 'completed', version = version + 1,
                       updated_at = @updatedAt, completed_at = @completedAt,
                       error_message = NULL
      WHERE id = @id AND version = @expectedVersion
    `);

    this.failStmt = this.db.prepare(`
      UPDATE tasks SET status = 'failed', version = version + 1,
                       updated_at = @updatedAt, error_message = @errorMessage,
                       retry_count = retry_count + 1
      WHERE id = @id AND version = @expectedVersion
    `);

    this.cancelStmt = this.db.prepare(`
      UPDATE tasks SET status = 'cancelled', version = version + 1, updated_at = @updatedAt
      WHERE id = @id AND version = @expectedVersion AND status NOT IN ('completed', 'cancelled')
    `);

    this.retryStmt = this.db.prepare(`
      UPDATE tasks SET status = @status, owner_agent_id = @ownerAgentId,
                       version = version + 1, updated_at = @updatedAt, error_message = NULL
      WHERE id = @id AND version = @expectedVersion
    `);

    this.unblockStmt = this.db.prepare(`
      UPDATE tasks SET status = 'pending', version = version + 1, updated_at = @updatedAt
      WHERE id = @id AND status = 'blocked'
    `);

    this.blockStmt = this.db.prepare(`
      UPDATE tasks SET status = 'blocked', version = version + 1, updated_at = @updatedAt,
                       error_message = @errorMessage
      WHERE id = @id AND status NOT IN ('completed', 'cancelled')
    `);

    this.setBlockedStmt = this.db.prepare(`
      UPDATE tasks SET status = 'blocked', version = version + 1, updated_at = @updatedAt
      WHERE id = @id AND status = 'pending'
    `);

    this.activeCountStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE status NOT IN ('completed', 'cancelled')",
    );

    this.getStmt = this.db.prepare("SELECT * FROM tasks WHERE id = ?");
    this.deleteStmt = this.db.prepare("DELETE FROM tasks WHERE id = ?");

    this.insertDepStmt = this.db.prepare(
      "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)",
    );
    this.getDepStmt = this.db.prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = ?");
    this.getDependentsStmt = this.db.prepare("SELECT task_id FROM task_dependencies WHERE depends_on_id = ?");

    this.upsertCapStmt = this.db.prepare(`
      INSERT INTO agent_capabilities (agent_id, capabilities, success_rate, total_completed, total_failed, updated_at)
      VALUES (@agentId, @capabilities, @successRate, @totalCompleted, @totalFailed, @updatedAt)
      ON CONFLICT(agent_id) DO UPDATE SET
        capabilities = @capabilities, success_rate = @successRate,
        total_completed = @totalCompleted, total_failed = @totalFailed,
        updated_at = @updatedAt
    `);
    this.getCapStmt = this.db.prepare("SELECT * FROM agent_capabilities WHERE agent_id = ?");
    this.getAllCapsStmt = this.db.prepare("SELECT * FROM agent_capabilities");
  }

  /** Get the count of active (non-completed, non-cancelled) tasks. */
  getActiveTaskCount(): number {
    const row = this.activeCountStmt.get() as { count: number };
    return row.count;
  }

  /** Create a new task in the graph. */
  createTask(opts: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    ownerAgentId?: string;
    parentTaskId?: string;
    input?: Record<string, unknown>;
    expectedOutput?: Record<string, unknown>;
    acceptanceCriteria?: string;
    requiredCapabilities?: string[];
    dependsOn?: string[];
    maxRetries?: number;
    timeoutMs?: number;
  }): TaskNode {
    // Enforce task count cap
    if (this.getActiveTaskCount() >= MAX_TASKS) {
      throw new Error(`Maximum active task limit (${MAX_TASKS}) reached`);
    }

    // Cycle detection for dependencies
    if (opts.dependsOn && opts.dependsOn.length > 0) {
      // Self-dependency check is handled by wouldCreateCycle naturally
      // but we need a task ID first - we'll check after insert using addDependencies
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    this.insertStmt.run({
      id,
      title: opts.title,
      description: opts.description ?? "",
      status: "pending",
      priority: opts.priority ?? 3,
      ownerAgentId: opts.ownerAgentId ?? null,
      parentTaskId: opts.parentTaskId ?? null,
      input: opts.input ? JSON.stringify(opts.input) : null,
      expectedOutput: opts.expectedOutput ? JSON.stringify(opts.expectedOutput) : null,
      acceptanceCriteria: opts.acceptanceCriteria ?? null,
      requiredCapabilities: JSON.stringify(opts.requiredCapabilities ?? []),
      maxRetries: Math.min(opts.maxRetries ?? 3, MAX_RETRIES_LIMIT),
      timeoutMs: opts.timeoutMs ? Math.min(opts.timeoutMs, MAX_TIMEOUT_MS) : null,
      createdAt: now,
      updatedAt: now,
    });

    // Insert dependencies and handle blocking
    if (opts.dependsOn && opts.dependsOn.length > 0) {
      if (this.wouldCreateCycle(id, opts.dependsOn)) {
        // Roll back the task we just created
        this.deleteStmt.run(id);
        throw new Error("Cannot create task: dependencies would create a cycle");
      }

      for (const depId of opts.dependsOn) {
        this.insertDepStmt.run(id, depId);
      }

      // Check if task is immediately blocked
      const hasIncomplete = opts.dependsOn.some((depId) => {
        const dep = this.getTask(depId);
        return dep && dep.status !== "completed";
      });
      if (hasIncomplete) {
        this.setBlockedStmt.run({ updatedAt: now, id });
      }
    }

    const task = this.getTask(id);
    if (!task) throw new Error("Failed to read back created task");
    this.emit({ type: "task_created", task });
    return task;
  }

  /** Get a single task by ID, with its dependencies resolved. */
  getTask(id: string): TaskNode | null {
    const row = this.getStmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToTask(row);
  }

  /** Query tasks with flexible filters. */
  queryTasks(query?: TaskQuery): TaskNode[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (query?.status) {
      if (Array.isArray(query.status)) {
        const placeholders = query.status.map((_, i) => `@status${i}`).join(", ");
        conditions.push(`status IN (${placeholders})`);
        for (let i = 0; i < query.status.length; i++) {
          params[`status${i}`] = query.status[i];
        }
      } else {
        conditions.push("status = @status");
        params.status = query.status;
      }
    }

    if (query?.ownerAgentId) {
      conditions.push("owner_agent_id = @ownerAgentId");
      params.ownerAgentId = query.ownerAgentId;
    }

    if (query?.parentTaskId) {
      conditions.push("parent_task_id = @parentTaskId");
      params.parentTaskId = query.parentTaskId;
    }

    if (query?.unowned) {
      conditions.push("owner_agent_id IS NULL");
    }

    // SQL-based unblocked filter: only tasks with all dependencies completed (or no dependencies)
    if (query?.unblocked) {
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM task_dependencies td
        JOIN tasks dep ON td.depends_on_id = dep.id
        WHERE td.task_id = tasks.id AND dep.status != 'completed'
      )`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = query?.limit ?? 100;

    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY priority ASC, created_at ASC LIMIT @limit`)
      .all({ ...params, limit }) as Array<Record<string, unknown>>;

    let tasks = rows.map((r) => this.rowToTask(r));

    // Post-filter for required capability (stored as JSON, can't easily filter in SQL)
    if (query?.requiredCapability) {
      const cap = query.requiredCapability;
      tasks = tasks.filter((t) => t.requiredCapabilities.includes(cap));
    }

    return tasks;
  }

  /** Get the next available task an agent can work on.
   *  Returns the highest priority unblocked, unowned task matching the agent's capabilities. */
  getNextTask(agentCapabilities?: string[]): TaskNode | null {
    const candidates = this.queryTasks({ status: "pending", unblocked: true, unowned: true });
    if (candidates.length === 0) return null;

    if (!agentCapabilities || agentCapabilities.length === 0) {
      return candidates[0];
    }

    // Prefer tasks whose required capabilities specifically match the agent's capabilities.
    // Tasks with specific requirements that match are prioritised over generic tasks.
    const specificMatch = candidates.filter(
      (t) => t.requiredCapabilities.length > 0 && t.requiredCapabilities.some((cap) => agentCapabilities.includes(cap)),
    );
    if (specificMatch.length > 0) return specificMatch[0];

    return candidates[0];
  }

  /** Assign a task to an agent. Uses optimistic locking to prevent races. */
  assignTask(taskId: string, agentId: string, expectedVersion: number): boolean {
    const now = new Date().toISOString();
    const result = this.assignStmt.run({
      ownerAgentId: agentId,
      updatedAt: now,
      id: taskId,
      expectedVersion,
    });
    if (result.changes > 0) {
      const task = this.getTask(taskId);
      if (task) this.emit({ type: "task_assigned", task, agentId });
      return true;
    }
    return false;
  }

  /** Mark a task as running (agent has started work). */
  startTask(taskId: string, expectedVersion: number): boolean {
    const now = new Date().toISOString();
    const result = this.updateStatusStmt.run({
      status: "running",
      updatedAt: now,
      id: taskId,
      expectedVersion,
    });
    if (result.changes > 0) {
      const task = this.getTask(taskId);
      if (task) this.emit({ type: "task_started", task });
      return true;
    }
    return false;
  }

  /** Complete a task with a result. Automatically unblocks dependent tasks. */
  completeTask(taskId: string, expectedVersion: number): { success: boolean; unblockedTasks: TaskNode[] } {
    const now = new Date().toISOString();
    const result = this.completeStmt.run({
      updatedAt: now,
      completedAt: now,
      id: taskId,
      expectedVersion,
    });

    if (result.changes === 0) return { success: false, unblockedTasks: [] };

    const task = this.getTask(taskId);
    if (task) this.emit({ type: "task_completed", task });

    // Unblock dependent tasks
    const unblockedTasks = this.unblockDependents(taskId);
    return { success: true, unblockedTasks };
  }

  /** Fail a task with an error message. Notifies dependent tasks. */
  failTask(
    taskId: string,
    expectedVersion: number,
    errorMessage: string,
  ): { success: boolean; blockedTasks: TaskNode[]; canRetry: boolean } {
    const now = new Date().toISOString();
    const result = this.failStmt.run({
      updatedAt: now,
      errorMessage,
      id: taskId,
      expectedVersion,
    });

    if (result.changes === 0) return { success: false, blockedTasks: [], canRetry: false };

    const task = this.getTask(taskId);
    if (!task) return { success: true, blockedTasks: [], canRetry: false };
    const canRetry = task.retryCount < task.maxRetries;

    this.emit({ type: "task_failed", task, errorMessage, canRetry });

    // Mark dependent tasks as blocked
    const blockedTasks = this.blockDependents(taskId, errorMessage);
    return { success: true, blockedTasks, canRetry };
  }

  /** Cancel a task. */
  cancelTask(taskId: string, expectedVersion: number): boolean {
    const now = new Date().toISOString();
    const result = this.cancelStmt.run({ updatedAt: now, id: taskId, expectedVersion });

    if (result.changes > 0) {
      const task = this.getTask(taskId);
      if (task) this.emit({ type: "task_cancelled", task });
      return true;
    }
    return false;
  }

  /** Retry a failed task by resetting it to pending and optionally reassigning. */
  retryTask(taskId: string, newAgentId?: string): boolean {
    const task = this.getTask(taskId);
    if (!task || task.status !== "failed") return false;
    if (task.retryCount >= task.maxRetries) return false;

    const now = new Date().toISOString();
    const newOwner = newAgentId ?? null;
    const newStatus = newOwner ? "assigned" : "pending";

    const result = this.retryStmt.run({
      status: newStatus,
      ownerAgentId: newOwner,
      updatedAt: now,
      id: taskId,
      expectedVersion: task.version,
    });

    if (result.changes > 0) {
      const updated = this.getTask(taskId);
      if (updated) this.emit({ type: "task_retried", task: updated, agentId: newAgentId ?? null });
      return true;
    }
    return false;
  }

  /** Delete a task and its dependencies. */
  deleteTask(taskId: string): boolean {
    const result = this.deleteStmt.run(taskId);
    return result.changes > 0;
  }

  /** Clear all tasks and capability profiles. Returns number of tasks deleted. */
  clearAll(): number {
    const result = this.db.prepare("DELETE FROM tasks").run();
    // task_dependencies cleaned up by CASCADE; also clear capability profiles for full reset
    this.db.prepare("DELETE FROM agent_capabilities").run();
    return result.changes;
  }

  /** Get all tasks that depend on a given task. */
  getDependentTasks(taskId: string): TaskNode[] {
    const rows = this.getDependentsStmt.all(taskId) as Array<{ task_id: string }>;
    return rows.map((r) => this.getTask(r.task_id)).filter((t): t is TaskNode => t !== null);
  }

  /** Get a DAG summary: counts by status, total tasks, blocked chains. */
  getSummary(): {
    total: number;
    byStatus: Record<TaskStatus, number>;
    blockedChains: number;
  } {
    const rows = this.db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all() as Array<{
      status: TaskStatus;
      count: number;
    }>;

    const byStatus: Record<TaskStatus, number> = {
      pending: 0,
      assigned: 0,
      running: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
      cancelled: 0,
    };

    let total = 0;
    for (const row of rows) {
      byStatus[row.status] = row.count;
      total += row.count;
    }

    // Count blocked chains (tasks blocked by failed tasks with no retries left)
    const blockedByFailedRows = this.db
      .prepare(
        `SELECT COUNT(DISTINCT td.task_id) as count
         FROM task_dependencies td
         JOIN tasks t ON td.depends_on_id = t.id
         WHERE t.status = 'failed' AND t.retry_count >= t.max_retries`,
      )
      .get() as { count: number };

    return { total, byStatus, blockedChains: blockedByFailedRows.count };
  }

  /** Add dependencies to an existing task. Checks for cycles. */
  addDependencies(taskId: string, depIds: string[]): void {
    if (depIds.length === 0) return;

    if (this.wouldCreateCycle(taskId, depIds)) {
      throw new Error("Cannot add dependencies: would create a cycle");
    }

    const now = new Date().toISOString();
    for (const depId of depIds) {
      this.insertDepStmt.run(taskId, depId);
    }

    // Check if task should be blocked
    const hasIncomplete = depIds.some((depId) => {
      const dep = this.getTask(depId);
      return dep && dep.status !== "completed";
    });
    if (hasIncomplete) {
      this.setBlockedStmt.run({ updatedAt: now, id: taskId });
    }
  }

  /** Run a function inside a SQLite transaction. */
  runInTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Update or create an agent's capability profile. */
  upsertCapabilityProfile(profile: AgentCapabilityProfile): void {
    this.upsertCapStmt.run({
      agentId: profile.agentId,
      capabilities: JSON.stringify(profile.capabilities),
      successRate: JSON.stringify(profile.successRate),
      totalCompleted: profile.totalCompleted,
      totalFailed: profile.totalFailed,
      updatedAt: profile.updatedAt,
    });
  }

  /** Get an agent's capability profile. */
  getCapabilityProfile(agentId: string): AgentCapabilityProfile | null {
    const row = this.getCapStmt.get(agentId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToCapProfile(row);
  }

  /** Get all capability profiles. */
  getAllCapabilityProfiles(): AgentCapabilityProfile[] {
    const rows = this.getAllCapsStmt.all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToCapProfile(r));
  }

  /** Record a task completion for an agent, updating their capability stats. */
  recordTaskOutcome(agentId: string, capabilities: string[], succeeded: boolean): void {
    let profile = this.getCapabilityProfile(agentId);
    if (!profile) {
      profile = {
        agentId,
        capabilities: {},
        successRate: {},
        totalCompleted: 0,
        totalFailed: 0,
        updatedAt: new Date().toISOString(),
      };
    }

    if (succeeded) {
      profile.totalCompleted++;
    } else {
      profile.totalFailed++;
    }

    // Update per-capability success rates using exponential moving average
    const alpha = 0.3; // weight of new observation
    for (const cap of capabilities) {
      const currentRate = profile.successRate[cap] ?? 0.5; // default 50%
      profile.successRate[cap] = currentRate * (1 - alpha) + (succeeded ? 1 : 0) * alpha;
      // Ensure confidence is tracked
      if (profile.capabilities[cap] === undefined) {
        profile.capabilities[cap] = 0.5;
      }
    }

    profile.updatedAt = new Date().toISOString();
    this.upsertCapabilityProfile(profile);
  }

  /** Score an agent against a task's requirements. Higher is better.
   *  Factors: capability match, success rate, overall reliability. */
  scoreAgent(agentId: string, task: TaskNode): number {
    const profile = this.getCapabilityProfile(agentId);
    if (!profile) return 0.1; // Unknown agent gets a low base score

    if (task.requiredCapabilities.length === 0) {
      // No specific requirements - score based on overall reliability
      const total = profile.totalCompleted + profile.totalFailed;
      if (total === 0) return 0.5;
      return profile.totalCompleted / total;
    }

    let totalScore = 0;
    let matchedCaps = 0;

    for (const reqCap of task.requiredCapabilities) {
      const confidence = profile.capabilities[reqCap] ?? 0;
      const successRate = profile.successRate[reqCap] ?? 0.5;

      if (confidence > 0) {
        matchedCaps++;
        totalScore += confidence * 0.4 + successRate * 0.6;
      }
    }

    if (matchedCaps === 0) return 0.05; // No capability match

    // Weight by coverage: agent that matches all requirements scores higher
    const coverage = matchedCaps / task.requiredCapabilities.length;
    return (totalScore / matchedCaps) * coverage;
  }

  /** Subscribe to task graph events. Returns unsubscribe function. */
  subscribe(listener: (event: TaskGraphEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Clean up tasks owned by a destroyed agent. Resets them to pending. */
  cleanupForAgent(agentId: string): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE tasks SET owner_agent_id = NULL, status = 'pending',
                          version = version + 1, updated_at = @updatedAt
         WHERE owner_agent_id = @agentId AND status IN ('assigned', 'running')`,
      )
      .run({ agentId, updatedAt: now });
    return result.changes;
  }

  /** Close the database. */
  close(): void {
    this.db.close();
  }

  /** Detect if adding dependencies from taskId to depIds would create a cycle.
   *  Uses BFS: starting from each depId, follow existing dependency edges.
   *  If we can reach taskId, adding the edge would close a cycle. */
  private wouldCreateCycle(taskId: string, depIds: string[]): boolean {
    const visited = new Set<string>();
    const queue = [...depIds];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (current === taskId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const deps = this.getDepStmt.all(current) as Array<{ depends_on_id: string }>;
      for (const dep of deps) {
        queue.push(dep.depends_on_id);
      }
    }
    return false;
  }

  private emit(event: TaskGraphEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break the task graph
      }
    }
  }

  /** When a task completes, check its dependents and unblock any that are fully resolved. */
  private unblockDependents(completedTaskId: string): TaskNode[] {
    const dependents = this.getDependentTasks(completedTaskId);
    const unblocked: TaskNode[] = [];

    for (const dep of dependents) {
      if (dep.status !== "blocked") continue;

      // Check if ALL dependencies of this dependent are now completed
      const allDepsCompleted = dep.dependsOn.every((depId) => {
        const task = this.getTask(depId);
        return task && task.status === "completed";
      });

      if (allDepsCompleted) {
        const now = new Date().toISOString();
        this.unblockStmt.run({ updatedAt: now, id: dep.id });

        const updated = this.getTask(dep.id);
        if (updated) {
          unblocked.push(updated);
          this.emit({ type: "task_unblocked", task: updated });
        }
      }
    }

    return unblocked;
  }

  /** When a task fails, mark its dependents as blocked. */
  private blockDependents(failedTaskId: string, reason: string): TaskNode[] {
    const dependents = this.getDependentTasks(failedTaskId);
    const blocked: TaskNode[] = [];

    for (const dep of dependents) {
      if (dep.status === "completed" || dep.status === "cancelled") continue;

      const now = new Date().toISOString();
      this.blockStmt.run({
        updatedAt: now,
        errorMessage: `Blocked: dependency ${failedTaskId.slice(0, 8)} failed - ${reason}`,
        id: dep.id,
      });

      const updated = this.getTask(dep.id);
      if (updated) {
        blocked.push(updated);
        this.emit({ type: "task_blocked", task: updated, reason });
      }
    }

    return blocked;
  }

  private rowToTask(row: Record<string, unknown>): TaskNode {
    const id = row.id as string;
    const deps = this.getDepStmt.all(id) as Array<{ depends_on_id: string }>;

    return {
      id,
      title: row.title as string,
      description: row.description as string,
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      ownerAgentId: (row.owner_agent_id as string) ?? null,
      parentTaskId: (row.parent_task_id as string) ?? null,
      input: row.input ? (JSON.parse(row.input as string) as Record<string, unknown>) : null,
      expectedOutput: row.expected_output
        ? (JSON.parse(row.expected_output as string) as Record<string, unknown>)
        : null,
      acceptanceCriteria: (row.acceptance_criteria as string) ?? null,
      requiredCapabilities: JSON.parse(row.required_capabilities as string) as string[],
      dependsOn: deps.map((d) => d.depends_on_id),
      version: row.version as number,
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
      timeoutMs: (row.timeout_ms as number) ?? null,
      errorMessage: (row.error_message as string) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: (row.completed_at as string) ?? null,
    };
  }

  private rowToCapProfile(row: Record<string, unknown>): AgentCapabilityProfile {
    return {
      agentId: row.agent_id as string,
      capabilities: JSON.parse(row.capabilities as string) as Record<string, number>,
      successRate: JSON.parse(row.success_rate as string) as Record<string, number>,
      totalCompleted: row.total_completed as number,
      totalFailed: row.total_failed as number,
      updatedAt: row.updated_at as string,
    };
  }
}

export type TaskGraphEvent =
  | { type: "task_created"; task: TaskNode }
  | { type: "task_assigned"; task: TaskNode; agentId: string }
  | { type: "task_started"; task: TaskNode }
  | { type: "task_completed"; task: TaskNode }
  | { type: "task_failed"; task: TaskNode; errorMessage: string; canRetry: boolean }
  | { type: "task_cancelled"; task: TaskNode }
  | { type: "task_retried"; task: TaskNode; agentId: string | null }
  | { type: "task_blocked"; task: TaskNode; reason: string }
  | { type: "task_unblocked"; task: TaskNode };
