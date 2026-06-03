/**
 * Workflow Resource Manager
 *
 * Infrastructure-level protections for Linear workflow runs:
 * - INF-1: Cost cap enforcement
 * - INF-3: Stall detection
 * - INF-4: Resource budgeting
 */

import type { AgentManager } from "./agents";
import { CONFIG } from "./config";
import { logger } from "./logger";
import { getContainerMemoryLimit, getContainerMemoryUsage } from "./utils/memory";

export const WORKFLOW_MAX_AGENTS = Number(process.env.WORKFLOW_MAX_AGENTS ?? "10");
export const WORKFLOW_COST_CAP_MULTIPLIER = 2.0;
export const WORKFLOW_STALL_TIMEOUT_MS = Number(process.env.WORKFLOW_STALL_TIMEOUT_MS ?? String(10 * 60_000));

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

export function checkWorkflowAgentLimit(currentCount: number, max = WORKFLOW_MAX_AGENTS): string | null {
  if (currentCount >= max) {
    return `Workflow agent limit reached (${currentCount}/${max}).`;
  }
  return null;
}

export function computeWorkflowActualCost(agentIds: string[], agentManager: AgentManager): number {
  let total = 0;
  for (const agentId of agentIds) {
    total += agentManager.get(agentId)?.usage?.estimatedCost ?? 0;
  }
  return total;
}

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
    if (!agent) continue;
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
