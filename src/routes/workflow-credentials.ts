import express, { type Request, type Response } from "express";
import { requireNotAgentService } from "../auth";
import { registerSecretValue } from "../sanitize";
import { validateToken } from "../token-validation";
import { errorMessage } from "../types";

/**
 * Routes for validating workflow credentials (Linear API key + GitHub PAT)
 * before a workflow is started.
 *
 * CM-4: Token validation endpoints
 */
export function createWorkflowCredentialsRouter() {
  const router = express.Router();

  /**
   * POST /api/workflows/validate-credentials
   * Validate a Linear API key and/or GitHub PAT.
   *
   * Body: { linearApiKey?: string, githubPat?: string }
   * Response: { valid: boolean, results: { linear?: ValidationResult, github?: ValidationResult } }
   */
  router.post("/api/workflows/validate-credentials", requireNotAgentService, async (req: Request, res: Response) => {
    try {
      const { linearApiKey, githubPat } = (req.body ?? {}) as {
        linearApiKey?: unknown;
        githubPat?: unknown;
      };

      if (!linearApiKey && !githubPat) {
        res.status(400).json({
          error: "At least one of linearApiKey or githubPat is required",
        });
        return;
      }

      const results: {
        linear?: { valid: boolean; user?: string; error?: string };
        github?: {
          valid: boolean;
          user?: string;
          scopes?: string[];
          warning?: string;
          error?: string;
        };
      } = {};

      if (linearApiKey !== undefined) {
        if (typeof linearApiKey !== "string" || linearApiKey.length > 1000 || linearApiKey.length < 8) {
          res.status(400).json({
            error: "linearApiKey must be a string between 8 and 1000 characters",
          });
          return;
        }
        // Register for redaction before any outbound network call
        registerSecretValue(linearApiKey);
        results.linear = await validateToken("linear", linearApiKey);
      }

      if (githubPat !== undefined) {
        if (typeof githubPat !== "string" || githubPat.length > 1000 || githubPat.length < 8) {
          res.status(400).json({
            error: "githubPat must be a string between 8 and 1000 characters",
          });
          return;
        }
        // Register for redaction before any outbound network call
        registerSecretValue(githubPat);
        const githubResult = await validateToken("github", githubPat);
        // Warn if using a classic PAT with the broad 'repo' scope — fine-grained PATs are preferred
        const hasRepoScope = githubResult.scopes?.includes("repo") ?? false;
        results.github = {
          ...githubResult,
          ...(hasRepoScope
            ? {
                warning:
                  "Classic PAT with 'repo' scope grants access to all your repositories. " +
                  "Consider using a fine-grained PAT scoped to specific repositories.",
              }
            : {}),
        };
      }

      const allValid = Object.values(results).every((r) => r.valid);
      res.status(allValid ? 200 : 422).json({ valid: allValid, results });
    } catch (err: unknown) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  return router;
}
