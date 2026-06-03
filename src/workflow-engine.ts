import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { logger } from "./logger";

// ─── Workflow Status (State Machine) ─────────────────────────────────────────

export type WorkflowStatus =
  | "created"
  | "estimating"
  | "awaiting_confirm"
  | "running"
  | "in_review"
  | "merging"
  | "completed"
  | "failed"
  | "cancelled"
  | "recovering";

const TERMINAL_STATES: ReadonlySet<WorkflowStatus> = new Set(["completed", "failed", "cancelled"]);

/** Valid state transitions per TD-4. `failed` and `cancelled` reachable from any non-terminal state. */
const TRANSITIONS: Record<string, ReadonlySet<WorkflowStatus>> = {
  created: new Set(["estimating", "failed", "cancelled"]),
  estimating: new Set(["awaiting_confirm", "failed", "cancelled"]),
  awaiting_confirm: new Set(["running", "failed", "cancelled"]),
  running: new Set(["in_review", "recovering", "failed", "cancelled"]),
  recovering: new Set(["running", "failed"]),
  in_review: new Set(["merging", "running", "failed", "cancelled"]),
  merging: new Set(["completed", "failed"]),
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface WorkflowRun {
  id: string;
  linearUrl: string;
  linearIssueId: string | null;
  repository: string;
  githubPatId: string | null;
  linearTokenId: string | null;
  status: WorkflowStatus;
  phase: string | null;
  costEstimateUsd: number | null;
  costActualUsd: number | null;
  taskCount: number;
  prUrl: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowAgent {
  workflowId: string;
  agentId: string;
  role: string;
  status: string | null;
  createdAt: string;
}

export type WorkflowEventType = "status_changed" | "agent_added" | "agent_removed" | "cost_updated" | "error";

export interface WorkflowEvent {
  type: WorkflowEventType;
  workflowId: string;
  data: Record<string, unknown>;
}

// ─── Database Setup ──────────────────────────────────────────────────────────

// Reuse scheduler.db per TD-1 — same pattern as scheduler.ts and cost-tracker.ts
const DB_DIR = existsSync("/persistent") ? "/persistent/scheduler-data" : "/tmp/scheduler-data";
const DB_PATH = path.join(DB_DIR, "scheduler.db");

export const MAX_ACTIVE_WORKFLOWS = 5;

// ─── WorkflowEngine ─────────────────────────────────────────────────────────

export class WorkflowEngine {
  private db: Database.Database;
  private insertRunStmt: Database.Statement;
  private updateStatusStmt: Database.Statement;
  private setFieldStmt: Record<string, Database.Statement> = {};
  private getRunStmt: Database.Statement;
  private listRunsStmt: Database.Statement;
  private listActiveRunsStmt: Database.Statement;
  private activeCountStmt: Database.Statement;
  private insertAgentStmt: Database.Statement;
  private removeAgentStmt: Database.Statement;
  private getAgentsStmt: Database.Statement;
  private getAgentWorkflowStmt: Database.Statement;
  private updateAgentStatusStmt: Database.Statement;
  private listeners = new Set<(event: WorkflowEvent) => void>();

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? DB_PATH;
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        linear_url TEXT NOT NULL,
        linear_issue_id TEXT,
        repository TEXT NOT NULL,
        github_pat_id TEXT,
        linear_token_id TEXT,
        status TEXT NOT NULL DEFAULT 'created',
        phase TEXT,
        cost_estimate_usd REAL,
        cost_actual_usd REAL,
        task_count INTEGER NOT NULL DEFAULT 0,
        pr_url TEXT,
        error TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_agents (
        workflow_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, agent_id)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_wf_runs_status ON workflow_runs(status);
      CREATE INDEX IF NOT EXISTS idx_wf_agents_agent ON workflow_agents(agent_id);
    `);

    this.insertRunStmt = this.db.prepare(`
      INSERT INTO workflow_runs (id, linear_url, linear_issue_id, repository, status,
                                  phase, cost_estimate_usd, task_count, metadata, created_at, updated_at)
      VALUES (@id, @linearUrl, @linearIssueId, @repository, @status,
              @phase, @costEstimateUsd, @taskCount, @metadata, @createdAt, @updatedAt)
    `);

    this.updateStatusStmt = this.db.prepare(
      "UPDATE workflow_runs SET status = @status, updated_at = @updatedAt WHERE id = @id",
    );

    // Generic field update statements
    for (const col of ["phase", "cost_estimate_usd", "cost_actual_usd", "pr_url", "error", "metadata", "task_count"]) {
      this.setFieldStmt[col] = this.db.prepare(
        `UPDATE workflow_runs SET ${col} = @value, updated_at = @updatedAt WHERE id = @id`,
      );
    }

    this.getRunStmt = this.db.prepare("SELECT * FROM workflow_runs WHERE id = @id");
    this.listRunsStmt = this.db.prepare("SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT @limit");
    this.listActiveRunsStmt = this.db.prepare(
      "SELECT * FROM workflow_runs WHERE status NOT IN ('completed','failed','cancelled') ORDER BY created_at DESC",
    );
    this.activeCountStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM workflow_runs WHERE status NOT IN ('completed','failed','cancelled')",
    );

    this.insertAgentStmt = this.db.prepare(`
      INSERT OR REPLACE INTO workflow_agents (workflow_id, agent_id, role, status, created_at)
      VALUES (@workflowId, @agentId, @role, @status, @createdAt)
    `);
    this.removeAgentStmt = this.db.prepare(
      "DELETE FROM workflow_agents WHERE workflow_id = @workflowId AND agent_id = @agentId",
    );
    this.getAgentsStmt = this.db.prepare("SELECT * FROM workflow_agents WHERE workflow_id = @workflowId");
    this.getAgentWorkflowStmt = this.db.prepare(
      "SELECT workflow_id FROM workflow_agents WHERE agent_id = @agentId LIMIT 1",
    );
    this.updateAgentStatusStmt = this.db.prepare(
      "UPDATE workflow_agents SET status = @status WHERE workflow_id = @workflowId AND agent_id = @agentId",
    );
  }

  // ─── Workflow CRUD ───────────────────────────────────────────────────────

  create(params: {
    linearUrl: string;
    linearIssueId?: string;
    repository: string;
    metadata?: Record<string, unknown>;
  }): WorkflowRun {
    const activeCount = (this.activeCountStmt.get() as { count: number }).count;
    if (activeCount >= MAX_ACTIVE_WORKFLOWS) {
      throw new Error(
        `Maximum ${MAX_ACTIVE_WORKFLOWS} concurrent workflows allowed. Wait for an existing workflow to complete.`,
      );
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    this.insertRunStmt.run({
      id,
      linearUrl: params.linearUrl,
      linearIssueId: params.linearIssueId ?? null,
      repository: params.repository,
      status: "created",
      phase: null,
      costEstimateUsd: null,
      taskCount: 0,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      createdAt: now,
      updatedAt: now,
    });

    const run = this.get(id);
    if (!run) throw new Error("Failed to create workflow run");
    return run;
  }

  get(id: string): WorkflowRun | null {
    const row = this.getRunStmt.get({ id }) as Record<string, unknown> | undefined;
    return row ? this.rowToWorkflow(row) : null;
  }

  list(limit = 50): WorkflowRun[] {
    return (this.listRunsStmt.all({ limit }) as Record<string, unknown>[]).map((r) => this.rowToWorkflow(r));
  }

  listActive(): WorkflowRun[] {
    return (this.listActiveRunsStmt.all() as Record<string, unknown>[]).map((r) => this.rowToWorkflow(r));
  }

  activeCount(): number {
    return (this.activeCountStmt.get() as { count: number }).count;
  }

  // ─── State Machine ───────────────────────────────────────────────────────

  /** Transition a workflow to a new status. Validates the transition is legal. */
  transition(id: string, newStatus: WorkflowStatus, error?: string): WorkflowRun {
    const run = this.get(id);
    if (!run) throw new Error(`Workflow not found: ${id}`);

    if (TERMINAL_STATES.has(run.status)) {
      throw new Error(`Cannot transition from terminal state '${run.status}'`);
    }

    const allowed = TRANSITIONS[run.status];
    if (!allowed?.has(newStatus)) {
      throw new Error(`Invalid transition: '${run.status}' → '${newStatus}'`);
    }

    const now = new Date().toISOString();
    this.updateStatusStmt.run({ id, status: newStatus, updatedAt: now });
    if (error) {
      this.setFieldStmt.error.run({ id, value: error, updatedAt: now });
    }

    const updated = this.get(id);
    if (!updated) throw new Error(`Workflow disappeared after transition: ${id}`);
    this.emit({ type: "status_changed", workflowId: id, data: { from: run.status, to: newStatus } });
    logger.info(`[workflow-engine] ${id.slice(0, 8)}: ${run.status} → ${newStatus}`, { workflowId: id });
    return updated;
  }

  isTerminal(id: string): boolean {
    const run = this.get(id);
    return run ? TERMINAL_STATES.has(run.status) : true;
  }

  // ─── Field Updates ───────────────────────────────────────────────────────

  setPhase(id: string, phase: string): void {
    this.setFieldStmt.phase.run({ id, value: phase, updatedAt: new Date().toISOString() });
  }

  setCostEstimate(id: string, costUsd: number): void {
    this.setFieldStmt.cost_estimate_usd.run({ id, value: costUsd, updatedAt: new Date().toISOString() });
  }

  setCostActual(id: string, costUsd: number): void {
    this.setFieldStmt.cost_actual_usd.run({ id, value: costUsd, updatedAt: new Date().toISOString() });
    this.emit({ type: "cost_updated", workflowId: id, data: { costActualUsd: costUsd } });
  }

  setPrUrl(id: string, prUrl: string): void {
    this.setFieldStmt.pr_url.run({ id, value: prUrl, updatedAt: new Date().toISOString() });
  }

  setMetadata(id: string, metadata: Record<string, unknown>): void {
    this.setFieldStmt.metadata.run({ id, value: JSON.stringify(metadata), updatedAt: new Date().toISOString() });
  }

  setTaskCount(id: string, count: number): void {
    this.setFieldStmt.task_count.run({ id, value: count, updatedAt: new Date().toISOString() });
  }

  // ─── Agent Tracking ──────────────────────────────────────────────────────

  addAgent(workflowId: string, agentId: string, role: string): void {
    this.insertAgentStmt.run({ workflowId, agentId, role, status: null, createdAt: new Date().toISOString() });
    this.emit({ type: "agent_added", workflowId, data: { agentId, role } });
  }

  removeAgent(workflowId: string, agentId: string): void {
    this.removeAgentStmt.run({ workflowId, agentId });
    this.emit({ type: "agent_removed", workflowId, data: { agentId } });
  }

  getAgents(workflowId: string): WorkflowAgent[] {
    return (this.getAgentsStmt.all({ workflowId }) as Record<string, unknown>[]).map((r) => ({
      workflowId: r.workflow_id as string,
      agentId: r.agent_id as string,
      role: r.role as string,
      status: (r.status as string) ?? null,
      createdAt: r.created_at as string,
    }));
  }

  getWorkflowForAgent(agentId: string): string | null {
    const row = this.getAgentWorkflowStmt.get({ agentId }) as { workflow_id: string } | undefined;
    return row?.workflow_id ?? null;
  }

  updateAgentStatus(workflowId: string, agentId: string, status: string): void {
    this.updateAgentStatusStmt.run({ workflowId, agentId, status });
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  subscribe(listener: (event: WorkflowEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WorkflowEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.warn("[workflow-engine] Event listener error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private rowToWorkflow(row: Record<string, unknown>): WorkflowRun {
    return {
      id: row.id as string,
      linearUrl: row.linear_url as string,
      linearIssueId: (row.linear_issue_id as string) ?? null,
      repository: row.repository as string,
      githubPatId: (row.github_pat_id as string) ?? null,
      linearTokenId: (row.linear_token_id as string) ?? null,
      status: row.status as WorkflowStatus,
      phase: (row.phase as string) ?? null,
      costEstimateUsd: (row.cost_estimate_usd as number) ?? null,
      costActualUsd: (row.cost_actual_usd as number) ?? null,
      taskCount: (row.task_count as number) ?? 0,
      prUrl: (row.pr_url as string) ?? null,
      error: (row.error as string) ?? null,
      metadata: row.metadata ? (JSON.parse(row.metadata as string) as Record<string, unknown>) : null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
