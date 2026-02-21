import { Router } from "express";
import type { AgentManager } from "../agents";
import { requireHumanUser, rotateJwtSecret } from "../auth";
import { activate, deactivate, getKillSwitchState } from "../kill-switch";
import { logger } from "../logger";
import { clearTombstone } from "../persistence";

export function createKillSwitchRouter(agentManager: AgentManager): Router {
  const router = Router();

  /** GET /api/kill-switch - returns current kill switch status */
  router.get("/api/kill-switch", (_req, res) => {
    res.json(getKillSwitchState());
  });

  /**
   * POST /api/kill-switch
   * Body: { action: "activate" | "deactivate", reason?: string }
   * Only human users may activate/deactivate; agent service tokens are rejected via requireHumanUser.
   */
  router.post("/api/kill-switch", requireHumanUser, async (req, res) => {
    const { action, reason } = req.body ?? {};

    if (action === "activate") {
      // Activate: set flag, destroy all agents, rotate JWT, write tombstone
      await activate(reason || "Manual activation via API");

      // Nuclear process kill - emergencyDestroyAll sets killed flag,
      // SIGKILLs all processes, deletes state, writes tombstone
      agentManager.emergencyDestroyAll();

      // Rotate JWT secret - all existing tokens (including agent service
      // tokens) are immediately invalidated
      rotateJwtSecret();

      logger.info("[kill-switch] Activation sequence complete");
      res.json({ ok: true, state: getKillSwitchState() });
    } else if (action === "deactivate") {
      // Deactivate: clear flag, clear tombstone, rotate JWT so human must re-authenticate
      await deactivate();
      clearTombstone();

      // Rotate JWT on deactivation too - human must log in again with the API key.
      // This ensures the session that activated the kill switch can't silently
      // continue as if nothing happened.
      rotateJwtSecret();

      logger.info("[kill-switch] Deactivation complete - JWT rotated, please re-authenticate");
      res.json({ ok: true, state: getKillSwitchState() });
    } else {
      res.status(400).json({ error: 'action must be "activate" or "deactivate"' });
    }
  });

  return router;
}
