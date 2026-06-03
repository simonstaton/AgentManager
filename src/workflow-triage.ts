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
  /** Real content that differs from the title and contains a verb/outcome */
  substance: boolean;
  /** A discernible "what should change" (outcome/behavior, not just a symptom) */
  goalClarity: boolean;
  /** Acceptance criteria / checklist / "done when" / expected behavior / repro steps */
  doneDef: boolean;
  /** Bounds the work: which area/feature/file/flow */
  scopeSignal: boolean;
  /** A request to BUILD/FIX — not a question, poll, discussion, or open design debate */
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

/**
 * Compute ticket clarity from triage check booleans.
 *
 * Hard failures (→ low):
 *   !actionability OR !substance
 * Require at least one of {doneDef, scopeSignal} to proceed beyond reject.
 * sat = count of {goalClarity, doneDef, scopeSignal} that are true:
 *   sat>=2 && (doneDef||scopeSignal) → high
 *   sat==1 && (doneDef||scopeSignal) → medium
 *   else → low
 */
export function clarityFromChecks(c: TriageChecks): "high" | "medium" | "low" {
  if (!c.actionability || !c.substance) return "low";
  if (!c.doneDef && !c.scopeSignal) return "low";
  const sat = [c.goalClarity, c.doneDef, c.scopeSignal].filter(Boolean).length;
  if (sat >= 2) return "high";
  if (sat === 1) return "medium";
  return "low";
}

/**
 * Map clarity level to a triage verdict.
 * high → accept, medium → accept_with_caveats, low → reject
 */
export function verdictFromClarity(clarity: "high" | "medium" | "low"): "accept" | "accept_with_caveats" | "reject" {
  if (clarity === "high") return "accept";
  if (clarity === "medium") return "accept_with_caveats";
  return "reject";
}

/**
 * Build a ValidationResult, injecting generic copy if missing/suggestions are empty on reject.
 */
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

/** Build the prompt for the triage agent (Haiku, maxTurns:15). */
export function buildTriagePrompt(ticketUrl: string, workflowId: string): string {
  return `You are a ticket-detail triage agent. Read the Linear ticket, evaluate 5 boolean checks, then POST a verdict message. Posting the verdict is your most important job — if you run low on turns, post your best-effort verdict immediately rather than continuing to read.

Ticket: ${ticketUrl} | Workflow: ${workflowId}

1. Read the ticket via the /linear MCP tools. On 403/404 set readError "not_found"/"forbidden"; auth fail → "auth_failed"; rate limit → "rate_limited". On ANY read error, set all 5 checks to false and still post (with the readError) — do NOT retry reads in a loop.
2. Evaluate honestly (conservative — false positives waste budget):
   - substance: description has real content differing from title with a verb/outcome
   - goalClarity: discernible "what should change" (outcome, not just symptom)
   - doneDef: acceptance criteria / "done when" / expected behavior / repro steps
   - scopeSignal: bounds the work — names area, feature, file, or flow
   - actionability: request to BUILD or FIX — not a question, poll, or discussion
3. Post EXACTLY ONE message to the platform message bus with your verdict in the metadata field. Run this curl with Bash, substituting your real values:

   curl -s --max-time 10 -X POST "http://localhost:\${PORT}/api/messages" \\
     -H "Authorization: Bearer $(cat \${WORKSPACE}/.agent-token)" \\
     -H "Content-Type: application/json" \\
     -d '{"from":"<YOUR_AGENT_ID>","fromName":"workflow-triage","type":"result","content":"triage verdict","metadata":{"workflowId":"${workflowId}","triageVerdict":{"checks":{"substance":false,"goalClarity":false,"doneDef":false,"scopeSignal":false,"actionability":false},"missing":[],"suggestions":[],"readError":"omit this key entirely if there was no read error"}}}'

   CRITICAL details (the backend silently drops the verdict otherwise):
   - Use plain http:// (the local server is NOT https — https gives an SSL/EPROTO error).
   - "from" is REQUIRED and MUST be YOUR OWN agent ID. Find it on the "**ID:**" line in your CLAUDE.md (the workspace path also contains it: /tmp/workspace-<YOUR_AGENT_ID>). A "from" that is missing or not your ID is rejected.
   - \${PORT} and \${WORKSPACE} are set in your environment / shown in your CLAUDE.md API section. If a curl fails, check the response body and fix it — you have turns to retry the POST.
   - Set each check to the literal true/false you decided. Replace missing/suggestions with real arrays (use them to explain a low-clarity ticket). Omit the "readError" key entirely when there was no read error.

Do NOT self-assess clarity or verdict — the backend computes them from your 5 booleans. After the POST returns success, stop.`;
}
