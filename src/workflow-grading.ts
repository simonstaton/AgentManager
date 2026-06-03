/**
 * Pure grading gate logic for BKL-020 Basic mode confidence grading.
 * All functions are pure (no I/O, no side effects).
 * Reuses GradeResult from grading.ts — do NOT redefine.
 *
 * Invariant: workflow grade gates PR creation. CI confidence label gates merge. Neither reads the other's store.
 */

import type { GradeResult } from "./grading";

function numericScoreFromGrade(g: GradeResult): number {
  const clarityMap: Record<string, number> = { high: 0, medium: 16, low: 33 };
  const confidenceMap: Record<string, number> = { high: 0, medium: 17, low: 34 };
  const blastMap: Record<string, number> = { isolated: 0, moderate: 17, broad: 33 };
  return (clarityMap[g.ticketClarity] ?? 0) + (confidenceMap[g.fixConfidence] ?? 0) + (blastMap[g.blastRadius] ?? 0);
}

/**
 * Gate decision based on overall risk.
 * low/medium → CREATE_PR; high → NEEDS_HUMAN (withhold, no PR in v1).
 * Gates on overallRisk (worst-case-axis rule from computeRisk), NOT numericScore.
 */
export function gradeGate(g: GradeResult): "CREATE_PR" | "NEEDS_HUMAN" {
  if (g.overallRisk === "high") return "NEEDS_HUMAN";
  return "CREATE_PR";
}

/**
 * Invert numericScore to a display-safe confidence value where higher = better.
 * grading.ts numericScore is 0-100 where higher = riskier.
 * CRITICAL: overallRisk==='high' always yields confidence < 60 (the Medium threshold).
 */
export function confidenceFromGrade(g: GradeResult): number {
  return 100 - numericScoreFromGrade(g);
}

/** Build the prompt for the workflow grader agent (Opus, maxTurns:12, read-only). */
export function buildGraderPrompt(workflowId: string, ticketUrl: string): string {
  return `You are a workflow grader (READ-ONLY). Assess completed engineering work against the original ticket.

Workflow: ${workflowId} | Ticket: ${ticketUrl}

READ-ONLY: use git diff/log/show + /linear MCP. Do NOT make code changes, create PRs, or run mutating commands.

1. Read the Linear ticket for acceptance criteria.
2. Review the git diff and test results.
3. Grade along three axes:
   - ticketClarity: how well-specified was the ticket? (high/medium/low)
   - fixConfidence: does the implementation correctly solve it? (high/medium/low)
   - blastRadius: how much of the system is affected? (isolated/moderate/broad)
4. Post ONE result with metadata:
{"workflowId":"${workflowId}","workflowGrade":{"graderAgentId":"<YOUR AGENT ID from CLAUDE.md>","ticketClarity":"...","fixConfidence":"...","blastRadius":"...","reasoning":"2-3 sentences"}}
Be conservative — grade lower when uncertain. A false high-confidence grade is a P0. Then stop.`;
}
