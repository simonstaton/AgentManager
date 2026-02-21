import type { Response } from "express";
import type { AgentManager } from "../agents";
import type { Agent } from "../types";

/**
 * Get agent by id; if missing, send 404 and return null.
 * Use in route handlers: `const agent = requireAgent(agentManager, id, res); if (!agent) return;`
 */
export function requireAgent(agentManager: AgentManager, id: string, res: Response): Agent | null {
  const agent = agentManager.get(id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return null;
  }
  return agent;
}
