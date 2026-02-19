import express, { type Request, type Response } from "express";
import type { AgentManager } from "../agents";

/**
 * Cost tracking route handler.
 *
 * Provides endpoints for tracking agent usage and costs.
 * Uses real token usage data from AgentManager (added in PR #40 / Issue #29).
 */
export function createCostRouter(agentManager: AgentManager) {
  const router = express.Router();

  /**
   * GET /api/cost/summary
   * Returns aggregated cost and usage summary across all agents.
   */
  router.get("/api/cost/summary", (_req: Request, res: Response) => {
    const agents = agentManager.list();
    let totalTokens = 0;
    let totalCost = 0;

    const agentCosts = agents.map((agent) => {
      const tokensUsed = (agent.usage?.tokensIn ?? 0) + (agent.usage?.tokensOut ?? 0);
      const estimatedCost = agent.usage?.estimatedCost ?? 0;

      totalTokens += tokensUsed;
      totalCost += estimatedCost;

      return {
        agentId: agent.id,
        agentName: agent.name,
        tokensUsed,
        estimatedCost,
        createdAt: agent.createdAt,
        status: agent.status,
      };
    });

    res.json({
      totalTokens,
      totalCost: Math.round(totalCost * 1e6) / 1e6,
      agentCount: agents.length,
      agents: agentCosts,
    });
  });

  /**
   * GET /api/cost/agent/:agentId
   * Returns cost details for a specific agent.
   */
  router.get("/api/cost/agent/:agentId", (req: Request, res: Response) => {
    const { agentId } = req.params;
    const agent = agentManager.list().find((a) => a.id === agentId);

    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const tokensUsed = (agent.usage?.tokensIn ?? 0) + (agent.usage?.tokensOut ?? 0);
    const estimatedCost = agent.usage?.estimatedCost ?? 0;

    res.json({
      agentId: agent.id,
      agentName: agent.name,
      tokensIn: agent.usage?.tokensIn ?? 0,
      tokensOut: agent.usage?.tokensOut ?? 0,
      tokensUsed,
      estimatedCost: Math.round(estimatedCost * 1e6) / 1e6,
      createdAt: agent.createdAt,
      status: agent.status,
    });
  });

  return router;
}
