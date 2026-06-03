/**
 * Pure triage logic for BKL-020 Basic mode ticket validation.
 *
 * All functions are pure (no I/O, no side effects) so they can be unit-tested
 * independently of the workflow wiring in routes/workflows.ts.
 *
 * Rubric (§5d): agent evaluates 5 boolean checks; backend computes clarity.
 * This keeps thresholds out of the prompt and prevents agents from self-grading.
 */

export interface TriageChecks {
  substance: boolean;
  goalClarity: boolean;
  doneDef: boolean;
  scopeSignal: boolean;
  actionability: boolean;
}

export interface ValidationResult {
  verdict: "accept" | "accept_with_caveats" | "reject";
  clarity: "high" | "medium" | "low";
  missing: string[];
  suggestions: string[];
  readError?: "not_found" | "forbidden" | "auth_failed" | "rate_limited" | "multi_issue_empty";
  evaluatedAt: string;
}

export function clarityFromChecks(c: TriageChecks): "high" | "medium" | "low" {
  if (!c.actionability || !c.substance) return "low";
  if (!c.doneDef && !c.scopeSignal) return "low";
  const sat = [c.goalClarity, c.doneDef, c.scopeSignal].filter(Boolean).length;
  if (sat >= 2) return "high";
  if (sat === 1) return "medium";
  return "low";
}

export function verdictFromClarity(clarity: "high" | "medium" | "low"): "accept" | "accept_with_caveats" | "reject" {
  if (clarity === "high") return "accept";
  if (clarity === "medium") return "accept_with_caveats";
  return "reject";
}

export function buildValidationResult(
  _checks: TriageChecks,
  verdict: "accept" | "accept_with_caveats" | "reject",
  clarity: "high" | "medium" | "low",
  missing: string[] = [],
  suggestions: string[] = [],
  readError?: ValidationResult["readError"],
): ValidationResult {
  let resolvedMissing = missing;
  let resolvedSuggestions = suggestions;

  if (verdict === "reject" && resolvedMissing.length === 0) {
    resolvedMissing = ["Ticket did not meet the detail rubric"];
  }
  if (verdict === "reject" && resolvedSuggestions.length === 0) {
    resolvedSuggestions = ["Add a description, acceptance criteria, and the affected area"];
  }

  return {
    verdict,
    clarity,
    missing: resolvedMissing,
    suggestions: resolvedSuggestions,
    ...(readError ? { readError } : {}),
    evaluatedAt: new Date().toISOString(),
  };
}

export function buildTriagePrompt(ticketUrl: string, workflowId: string): string {
  return `You are a ticket-detail triage agent for workflow ${workflowId}. Ticket: ${ticketUrl}`;
}
