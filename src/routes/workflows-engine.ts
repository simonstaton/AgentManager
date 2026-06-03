import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import type { AgentManager } from "../agents";
import { requireNotAgentService } from "../auth";
import { ALLOWED_MODELS, DEFAULT_MODEL } from "../guardrails";
import { logger } from "../logger";
import type { MessageBus } from "../messages";
import { registerSecretValue } from "../sanitize";
import { errorMessage } from "../types";
import { sanitizeRepoName } from "../validation";
import { confidenceFromGrade, gradeGate } from "../workflow-grading";
import {
  checkMemoryForNewWorkflow,
  checkWorkflowAgentLimit,
  detectWorkflowStall,
  enforceWorkflowCostCap,
  WORKFLOW_MAX_AGENTS,
} from "../workflow-resource-manager";
import {
  buildSafeLinearUrl,
  evictStaleWorkflows,
  isValidGithubPat,
  isValidLinearApiKey,
  type LinearEntityType,
  type LinearWorkflow,
  MAX_STORED_WORKFLOWS,
  MAX_WORKFLOWS,
  parseLinearUrl,
  RUNNING_WALL_CLOCK_TIMEOUT_MS,
} from "../workflow-routes-helpers";
import {
  buildTriagePrompt,
  buildValidationResult,
  clarityFromChecks,
  type TriageChecks,
  verdictFromClarity,
} from "../workflow-triage";

/** In-memory workflow store for the engine-backed router. */
export const engineWorkflows = new Map<string, LinearWorkflow>();

/** Build the manager agent prompt for a new workflow. */
export function buildEngineManagerPrompt(
  safeLinearUrl: string,
  repository: string,
  workflowId: string,
  entityType: LinearEntityType = "issue",
): string {
  const entityLabel = entityType === "issue" ? "Linear ticket" : `Linear ${entityType}`;
  return `You are a senior engineer completing a ${entityLabel} from ${safeLinearUrl}.

Repository: ${repository} | Workflow ID: ${workflowId}

## Your task
1. Read the ${entityLabel} using the /linear MCP tool.
2. Identify acceptance criteria and scope.
3. Clone/checkout the repository, implement the changes, write tests.
4. Run the project's build and test commands to verify correctness.
5. Push a feature branch and open a pull request.
6. Report the PR URL back via a result message: {"workflowId":"${workflowId}","prUrl":"<url>","status":"completed"}

## Rules
- Work autonomously. Keep commits small. Post status updates every 30 minutes.
- If blocked, document it in the PR description and report back.`;
}

export function createWorkflowsEngineRouter(agentManager: AgentManager, messageBus: MessageBus) {
  const router = express.Router();

  // ── INF-3: Stall detection watchdog ──────────────────────────────────────
  const watchdogInterval = setInterval(() => {
    for (const [wfId, workflow] of engineWorkflows) {
      if (workflow.status !== "running") continue;

      const agentIds = workflow.agents.map((a) => a.id);

      if (workflow.costEstimate && workflow.costEstimate > 0) {
        enforceWorkflowCostCap(wfId, agentIds, workflow.costEstimate, agentManager, (workflowId, actualCost, cap) => {
          for (const agentId of agentIds) agentManager.pause(agentId);
          workflow.status = "failed";
          workflow.error = `Cost cap exceeded: $${actualCost.toFixed(4)} >= $${cap.toFixed(4)}`;
          workflow.updatedAt = new Date().toISOString();
          logger.warn(`[engine-watchdog] INF-1: Halted workflow ${workflowId}`);
        });
      }

      if (workflow.status !== "running") continue;

      detectWorkflowStall(wfId, agentIds, agentManager, (workflowId, idleMs) => {
        const managerId = workflow.agents[0]?.id;
        if (managerId) {
          messageBus.post({
            from: "workflow-engine",
            fromName: "workflow-engine",
            to: managerId,
            type: "status",
            content: `Workflow stall: all agents idle for ${Math.round(idleMs / 60_000)} min. Are you blocked?`,
            metadata: { workflowId, idleMs, event: "stall_detected" },
          });
        }
      });

      const runningAge = Date.now() - new Date(workflow.createdAt).getTime();
      if (runningAge > RUNNING_WALL_CLOCK_TIMEOUT_MS) {
        for (const agentId of agentIds) agentManager.pause(agentId);
        workflow.status = "failed";
        workflow.error = "Workflow exceeded the 60-minute wall-clock limit.";
        workflow.updatedAt = new Date().toISOString();
        logger.warn(`[engine-watchdog] Wall-clock timeout for workflow ${wfId}`);
      }
    }
  }, 60_000);

  watchdogInterval.unref();

  // ── GET /api/workflows ────────────────────────────────────────────────────
  router.get("/api/workflows", (_req: Request, res: Response) => {
    const all = Array.from(engineWorkflows.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    res.json(all);
  });

  // ── GET /api/workflows/:id ────────────────────────────────────────────────
  router.get("/api/workflows/:id", (req: Request<{ id: string }>, res: Response) => {
    const workflow = engineWorkflows.get(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json(workflow);
  });

  // ── POST /api/workflows/linear ────────────────────────────────────────────
  router.post("/api/workflows/linear", requireNotAgentService, async (req: Request, res: Response) => {
    try {
      const { linearUrl, repository, linearApiKey, githubPat, model, basicMode } = (req.body ?? {}) as {
        linearUrl?: unknown;
        repository?: unknown;
        linearApiKey?: unknown;
        githubPat?: unknown;
        model?: unknown;
        basicMode?: unknown;
      };

      if (typeof linearUrl !== "string" || !linearUrl) {
        res.status(400).json({ error: "linearUrl is required" });
        return;
      }

      const parsed = parseLinearUrl(linearUrl);
      if (!parsed) {
        res.status(400).json({ error: "Invalid linearUrl: must be a valid Linear issue, project, cycle, or view URL" });
        return;
      }

      const safeLinearUrl = buildSafeLinearUrl(parsed);

      if (typeof repository !== "string" || !repository) {
        res.status(400).json({ error: "repository is required (owner/repo format)" });
        return;
      }

      const repoName = sanitizeRepoName(repository);
      if (!repoName) {
        res.status(400).json({ error: "repository must match owner/repo format" });
        return;
      }

      const resolvedModel =
        typeof model === "string" && (ALLOWED_MODELS as readonly string[]).includes(model) ? model : DEFAULT_MODEL;

      if (linearApiKey !== undefined) {
        if (typeof linearApiKey !== "string" || !isValidLinearApiKey(linearApiKey)) {
          res.status(400).json({ error: "linearApiKey must be a valid Linear API key (lin_api_ prefix, 32+ chars)" });
          return;
        }
        registerSecretValue(linearApiKey);
      }

      if (githubPat !== undefined) {
        if (typeof githubPat !== "string" || !isValidGithubPat(githubPat)) {
          res.status(400).json({ error: "githubPat must be a valid GitHub PAT" });
          return;
        }
        registerSecretValue(githubPat);
      }

      const activeCount = Array.from(engineWorkflows.values()).filter(
        (w) => w.status !== "completed" && w.status !== "failed" && w.status !== "cancelled" && w.status !== "rejected",
      ).length;

      const limitError = checkWorkflowAgentLimit(activeCount, MAX_WORKFLOWS);
      if (limitError) {
        res.status(429).json({ error: limitError });
        return;
      }

      const memoryError = checkMemoryForNewWorkflow();
      if (memoryError) {
        res.status(503).json({ error: memoryError });
        return;
      }

      evictStaleWorkflows(engineWorkflows);

      const workflowId = crypto.randomUUID();
      const now = new Date().toISOString();

      const workflow: LinearWorkflow = {
        id: workflowId,
        linearUrl: safeLinearUrl,
        repository: repoName,
        status: basicMode ? "validating" : "starting",
        agents: [],
        hasCredentials: !!(linearApiKey || githubPat),
        createdAt: now,
        updatedAt: now,
      };

      engineWorkflows.set(workflowId, workflow);

      if (basicMode) {
        const triagePrompt = buildTriagePrompt(safeLinearUrl, workflowId);
        const { agent: triageAgent } = agentManager.create({
          prompt: triagePrompt,
          name: `triage-${workflowId.slice(0, 8)}`,
          model: resolvedModel,
          role: "reviewer",
        });
        workflow.triageAgentId = triageAgent.id;
        workflow.agents = [{ id: triageAgent.id, name: triageAgent.name, role: "reviewer" }];
        workflow.updatedAt = new Date().toISOString();
      } else {
        const managerPrompt = buildEngineManagerPrompt(safeLinearUrl, repoName, workflowId, parsed.entityType);
        const { agent: managerAgent } = agentManager.create({
          prompt: managerPrompt,
          name: `wf-${workflowId.slice(0, 8)}`,
          model: resolvedModel,
          role: "developer",
        });
        workflow.status = "running";
        workflow.agents = [{ id: managerAgent.id, name: managerAgent.name, role: "developer" }];
        workflow.updatedAt = new Date().toISOString();
      }

      res.status(201).json(workflow);
    } catch (err: unknown) {
      logger.error(`[workflows-engine] Failed to start workflow: ${errorMessage(err)}`);
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ── DELETE /api/workflows/:id ─────────────────────────────────────────────
  router.delete("/api/workflows/:id", requireNotAgentService, async (req: Request<{ id: string }>, res: Response) => {
    const workflow = engineWorkflows.get(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    for (const agent of workflow.agents) {
      try {
        await agentManager.destroy(agent.id);
      } catch (err: unknown) {
        logger.warn(`[workflows-engine] Failed to destroy agent ${agent.id}: ${errorMessage(err)}`);
      }
    }
    workflow.status = "cancelled";
    workflow.updatedAt = new Date().toISOString();
    res.json(workflow);
  });

  return router;
}

export function _clearEngineWorkflowsForTest(): void {
  engineWorkflows.clear();
}

export function _injectEngineWorkflowForTest(workflow: LinearWorkflow): void {
  engineWorkflows.set(workflow.id, workflow);
}
