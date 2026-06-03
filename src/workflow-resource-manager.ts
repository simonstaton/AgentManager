/**
 * Workflow Resource Manager
 *
 * Infrastructure-level protections for Linear workflow runs:
 * - INF-1: Cost cap enforcement — halt workflow agents when actual cost exceeds 2× the estimate
 * - INF-3: Stall detection — detect when all workflow agents have been idle for >10 minutes
 * - INF-4: Resource budgeting — system memory threshold and per-workflow agent limits
 *
 * These are pure functions designed to be called from the workflow router's periodic watchdog.
 * They do not modify state directly; callers provide callbacks for side effects.
 */

import type { AgentManager } from "./agents";
import { CONFIG } from "./config";
import { logger } from "./logger";
import { getContainerMemoryLimit, getContainerMemoryUsage } from "./utils/memory";

/** Max agents allowed per workflow (default 10). Override via WORKFLOW_MAX_AGENTS env var. */
export const WORKFLOW_MAX_AGENTS = Number(process.env.WORKFLOW_MAX_AGENTS ?? "10");

/** Halt workflow when actual cost reaches this multiple of the cost estimate. */
export const WORKFLOW_COST_CAP_MULTIPLIER = 2.0;

/**
 * Duration (ms) all agents must be inactive before declaring a workflow stalled.
 * Default: 10 minutes. Override via WORKFLOW_STALL_TIMEOUT_MS env var.
 */
export const WORKFLOW_STALL_TIMEOUT_MS = Number(process.env.WORKFLOW_STALL_TIMEOUT_MS ?? String(10 * 60_000));

/**
 * INF-4: Check container/system memory before starting a new workflow.
 * Uses cgroup v2 memory stats (accurate container-level usage including child processes).
 * Returns an error message if usage exceeds MEMORY_REJECT_THRESHOLD, null if OK.
 */
export function checkMemoryForNewWorkflow(): string | null {
  const used = getContainerMemoryUsage();
  const limit = getContainerMemoryLimit();
  const ratio = used / limit;
  if (ratio > CONFIG.MEMORY_REJECT_THRESHOLD) {
    return (
      `System memory at ${Math.round(ratio * 100)}% ` +
      `(threshold: ${Math.round(CONFIG.MEMORY_REJECT_THRESHOLD * 100)}%). ` +
      "Cannot start new workflow."
    );
  }
  return null;
}

/**
 * INF-4: Check per-workflow agent count before spawning another agent.
 * Returns an error message if the limit is reached, null if OK.
 */
export function checkWorkflowAgentLimit(currentCount: number, max = WORKFLOW_MAX_AGENTS): string | null {
  if (currentCount >= max) {
    return `Workflow agent limit reached (${currentCount}/${max}).`;
  }
  return null;
}

/**
 * INF-1: Compute the total actual cost for a set of agent IDs by summing
 * each agent's usage.estimatedCost from the AgentManager registry.
 * Agents not found in the registry (destroyed) contribute 0.
 */
export function computeWorkflowActualCost(agentIds: string[], agentManager: AgentManager): number {
  let total = 0;
  for (const agentId of agentIds) {
    total += agentManager.get(agentId)?.usage?.estimatedCost ?? 0;
  }
  return total;
}

/**
 * INF-1: Enforce workflow cost cap.
 * Computes actual cost for all agent IDs; if it meets or exceeds
 * WORKFLOW_COST_CAP_MULTIPLIER × costEstimate, invokes onCap.
 * No-op when costEstimate <= 0 (no estimate available, cap disabled).
 */
export function enforceWorkflowCostCap(
  workflowId: string,
  agentIds: string[],
  costEstimate: number,
  agentManager: AgentManager,
  onCap: (workflowId: string, actualCost: number, cap: number) => void,
): void {
  if (costEstimate <= 0) return;
  const actual = computeWorkflowActualCost(agentIds, agentManager);
  const cap = costEstimate * WORKFLOW_COST_CAP_MULTIPLIER;
  if (actual >= cap) {
    logger.warn("[workflow-guard] INF-1: Workflow cost cap exceeded", {
      workflowId,
      actualCost: actual.toFixed(4),
      cap: cap.toFixed(4),
      multiplier: WORKFLOW_COST_CAP_MULTIPLIER,
    });
    onCap(workflowId, actual, cap);
  }
}

/**
 * INF-3: Detect whether all live agents in a workflow have been idle for
 * longer than WORKFLOW_STALL_TIMEOUT_MS.
 *
 * "Live" means the agent still exists in the AgentManager registry; destroyed agents
 * are skipped. If any agent is actively running or starting, returns false.
 * Returns true and invokes onStall if a stall is detected.
 */
export function detectWorkflowStall(
  workflowId: string,
  agentIds: string[],
  agentManager: AgentManager,
  onStall: (workflowId: string, idleMs: number) => void,
): boolean {
  if (agentIds.length === 0) return false;

  const now = Date.now();
  let oldestIdleAt = now;
  let liveAgents = 0;

  for (const agentId of agentIds) {
    const agent = agentManager.get(agentId);
    if (!agent) continue; // agent was destroyed — skip
    liveAgents++;

    if (agent.status === "running" || agent.status === "starting") return false;

    const lastActivity = new Date(agent.lastActivity).getTime();
    if (lastActivity < oldestIdleAt) oldestIdleAt = lastActivity;
  }

  if (liveAgents === 0) return false;

  const idleMs = now - oldestIdleAt;
  if (idleMs > WORKFLOW_STALL_TIMEOUT_MS) {
    logger.warn("[workflow-guard] INF-3: Stalled workflow detected", {
      workflowId,
      idleForSec: Math.round(idleMs / 1000),
      liveAgents,
    });
    onStall(workflowId, idleMs);
    return true;
  }
  return false;
}
