/**
 * Pure grading gate logic for BKL-020 Basic mode confidence grading.
 * All functions are pure (no I/O, no side effects).
 * Reuses GradeResult from grading.ts.
 */

import type { GradeResult, RiskLevel } from "./grading";

const RISK_SCORE: Record<RiskLevel, number> = {
  low: 20,
  medium: 55,
  high: 90,
};

export function gradeGate(g: GradeResult): "CREATE_PR" | "NEEDS_HUMAN" {
  if (g.overallRisk === "high") return "NEEDS_HUMAN";
  return "CREATE_PR";
}

export function confidenceFromGrade(g: GradeResult): number {
  return 100 - RISK_SCORE[g.overallRisk];
}

export function buildGraderPrompt(workflowId: string, ticketUrl: string): string {
  return `You are a workflow grader (READ-ONLY). Workflow: ${workflowId} | Ticket: ${ticketUrl}. Grade and post result.`;
}
