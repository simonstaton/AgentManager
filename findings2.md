# Routes & Server Code Quality Audit — 2026-02-20

**Auditor:** Auditor agent (8d12258e)  
**Scope:** server.ts + all 12 route files in src/routes/  
**Commit:** same as main audit (61d39ad)

**Status (2026-02-21):** Many findings below were addressed in the main audit follow-up (see `findings.md`).  
**Already fixed:** Finding 1 (handleFatalError), 3 (requireHumanUser), 4 (logger.*), 13 (VALID_MESSAGE_TYPES), 14 (validateMessageBody / constants), 15 (MAX_* constants), 17 (cost.get), 19 (GUARDRAIL_SPECS), 25 (404 status), 26 (onIdle null check).  
**Fixed this session (2026-02-21):** 5 (errorMessage in context.ts), 6 (useless comment server.ts), 10 (AuthenticatedRequest in config), 11 (log destroy() return in workflows), 12 (POST /api/agents create → 500), 16 (clearContext httpStatus from result.error), 18 (syncClaudeHome awaited + synced in response), 20 (mcp SETTINGS_PATH from CLAUDE_HOME), 23 (workflows Map inside factory), 24 (buildManagerPrompt in templates/).  
**Still optional:** 2 (formatDeliveryPrompt DRY), 7–8 (comments), 21 (cost/usage DRY), 22 (JSDoc cost), 27 (health.ts rename).

---

## Summary

Overall, the codebase is reasonably well - structured.Route files follow a consistent factory - function pattern(`createXRouter(deps)`) which is clean.However, there are several actionable quality issues ranging from DRY violations to reliability concerns.

** Total findings: 27 **
  - HIGH: 5
    - MEDIUM: 12
      - LOW: 10

---

## Findings

### Finding 1 — DRY Violation: Duplicated exception handlers
  - ** File:** `/repo/server.ts`, lines 482 - 532
    - ** Category:** DRY violations
      - ** Severity:** MEDIUM
        - ** Description:** The`uncaughtException` and `unhandledRejection` handlers are nearly identical ~25 - line blocks.They both close the server, call`emergencyDestroyAll()`, and exit after a delay.The only difference is the log message.
- ** Code:**
  ```ts
process.on("uncaughtException", (err) => {
  // ... 20 lines of shutdown logic
});
process.on("unhandledRejection", (reason) => {
  // ... same 20 lines of shutdown logic
});
```
  - ** Fix:** Extract a `fatalShutdown(reason: string, detail: unknown)` function and call it from both handlers.

---

### Finding 2 — DRY Violation: `formatDeliveryPrompt` called with identical pattern 3 times
  - ** File:** `/repo/server.ts`, lines 229 - 233, 250, 300
    - ** Category:** DRY violations
      - ** Severity:** LOW
        - ** Description:** The`formatDeliveryPrompt` function is called identically in the`subscribe` callback, the`interrupt` branch, and the `onIdle` handler.The surrounding try/catch/finally blocks also follow the same pattern(markRead, log, message, catch, deliveryDone). This is borderline — 3 call sites is the threshold where extraction starts to pay off.
- ** Fix:** Consider extracting a `deliverMessage(msg, agent, header)` helper that encapsulates the markRead / log / message /catch/deliveryDone pattern.

---

### Finding 3 — DRY Violation: Agent - service auth guard pattern repeated 10 + times
  - ** Files:** `agents.ts:359,376,395`, `config.ts:63,295`, `cost.ts:82`, `kill-switch.ts:27`, `scheduler.ts:34,84`, `workflows.ts:118,258`
    - ** Category:** DRY violations
      - ** Severity:** HIGH
        - ** Description:** The pattern `if ((req as AuthenticatedRequest).user?.sub === "agent-service") { res.status(403).json(...); return; }` is copy - pasted across 10 + route handlers with slight variations in casting style: some use`(req as AuthenticatedRequest)`, some use`(req as any).user`, and one uses a local`const authReq = req as AuthenticatedRequest`.
- ** Code examples:**
  ```ts
// agents.ts:359 — uses AuthenticatedRequest
if ((req as AuthenticatedRequest).user?.sub === "agent-service") {
// config.ts:62 — uses any with biome-ignore
const user = (req as any).user;
if (user?.sub === "agent-service") {
// scheduler.ts:33 — uses local variable
const authReq = req as AuthenticatedRequest;
if (authReq.user?.sub === "agent-service") {
```
  - ** Fix:** Create a shared middleware `rejectAgentService(req, res, next)` and apply it to routes that need it.This eliminates the repeated code AND the inconsistent casting styles.

---

### Finding 4 — Inconsistent logging: `console.*` vs`logger.*`
  - ** Files:** `mcp.ts`(10 occurrences), `config.ts`(4), `context.ts`(2), `kill-switch.ts`(2), `workflows.ts`(3)
    - ** Category:** Maintainability issues
      - ** Severity:** MEDIUM
        - ** Description:** `server.ts` consistently uses the structured `logger` import, but all route files use raw `console.log/warn/error` instead.This means route - level logs bypass any structured logging, log levels, or output formatting that `logger` provides.
- ** Code:**
  ```ts
// server.ts uses logger:
logger.info("[auto-deliver] Delivering message", { agentId, sender });
// routes use console:
console.log(`[MCP - Routes] Initiating OAuth flow for ${ server }`);
console.error("[MCP-Routes] Error listing servers:", err);
```
  - ** Fix:** Replace all `console.*` calls in route files with `logger.*` calls.Import `logger` from`"../logger"`.This is a mechanical find - and - replace.

---

### Finding 5 — Inconsistent error message extraction
  - ** Files:** `context.ts:99,129`, `scheduler.ts:76` vs`config.ts`, `workflows.ts`, `mcp.ts`
    - ** Category:** Maintainability issues
      - ** Severity:** LOW
        - ** Description:** `context.ts` and `scheduler.ts` use inline `err instanceof Error ? err.message : String(err)` while `config.ts`, `workflows.ts`, and`mcp.ts` import and use `errorMessage()` from`../types`.The project's CLAUDE.md explicitly says to use `errorMessage()` from `src/types.ts`.
          - ** Code:**
            ```ts
// context.ts:99 — inline pattern (inconsistent)
console.error(`[context] Failed to sync: `, err instanceof Error ? err.message : String(err));
// config.ts:242 — uses errorMessage() (correct)
console.warn("[config] Failed to sync:", errorMessage(err));
```
  - ** Fix:** Replace inline `err instanceof Error ? err.message : String(err)` with `errorMessage(err)` in `context.ts` and`scheduler.ts`, and add the import.

---

### Finding 6 — Useless inline comment: restates the code
  - ** File:** `/repo/server.ts`, line 48
    - ** Category:** Useless inline comments
      - ** Severity:** LOW
        - ** Description:**
          ```ts
// Exception handlers will be set up after server and agentManager are initialized
let exceptionHandlersSetup = false;
```
The variable name already conveys this.The comment adds no information.
- ** Fix:** Remove the comment.

---

### Finding 7 — Useless inline comment: restates obvious code
  - ** File:** `/repo/src/routes/agents.ts`, lines 21, 102
    - ** Category:** Useless inline comments
      - ** Severity:** LOW
        - ** Description:**
          ```ts
// List all agents
router.get("/api/agents", ...
// Create agent (streams SSE)
router.post("/api/agents", ...
```
The HTTP verb + route path already conveys the intent clearly.These comments add no value.
- ** Fix:** Remove obvious route - action comments(though this is low priority and somewhat subjective).

---

### Finding 8 — Stale / obsolete comment block
  - ** File:** `/repo/src/routes/agents.ts`, lines 24 - 28
    - ** Category:** Obsolete / dead code
      - ** Severity:** LOW
        - ** Description:**
          ```ts
// NOTE: Previously touched all agents here to prevent TTL cleanup while UI is active.
// Removed because it prevents TTL-based cleanup entirely - any open dashboard tab
// resets every agent's lastActivity every 5s. Individual agent interactions
// (GET /api/agents/:id, message, events) still touch the specific agent.
```
This is a historical note about removed code.It has value as context but is getting stale.If the team relies on commit history for this kind of context, it can be removed.
- ** Fix:** Remove or condense to a one - liner: `// Intentionally does NOT touch agents — see commit history for rationale.`

---

### Finding 9 — AI artifact: emdash in error message
  - ** File:** `/repo/server.ts`, line 96
    - ** Category:** AI artifacts
      - ** Severity:** LOW
        - ** Description:**
          ```ts
error: "Kill switch is active - all agent operations are disabled",
```
This particular instance uses a regular hyphen - dash, which is fine.However, the broader codebase has some emdash usage in comments(e.g., server.ts line 154 `// -- Instance keep-alive`) which is decorative and fine.No actual emdash(U + 2014) characters found in these files.Marking as clean on this criterion.
- ** Fix:** N / A — no actual emdash issues in the audited files.

---

### Finding 10 — Over - complex: `biome-ignore` workaround for auth typing
  - ** Files:** `config.ts:61,293`, `workflows.ts:116,256`
    - ** Category:** Over - complex abstractions / KISS violations
      - ** Severity:** MEDIUM
        - ** Description:** Four places use `// biome-ignore lint/suspicious/noExplicitAny` to cast `req` to `any` for accessing`.user`.The project already has `AuthenticatedRequest` type.The `any` cast with biome - ignore is unnecessary.
- ** Code:**
  ```ts
// biome-ignore lint/suspicious/noExplicitAny: Express Request augmentation for auth
const user = (req as any).user;
```
  - ** Fix:** Replace with `(req as AuthenticatedRequest).user` and import `AuthenticatedRequest`.This eliminates 4 lint suppressions.

---

### Finding 11 — Reliability: Missing error handling on `agentManager.destroy()` return
- ** File:** `/repo/src/routes/workflows.ts`, line 272
  - ** Category:** Reliability issues
    - ** Severity:** LOW
      - ** Description:** `agentManager.destroy(agent.id)` is awaited inside a try/catch, but `destroy()` returns a boolean. The return value is ignored, meaning if the agent was already gone, no logging occurs.
        - ** Fix:** Minor — log when `destroy()` returns false for forensics.

---

### Finding 12 — Reliability: `POST /api/agents` sends 400 for all creation errors
  - ** File:** `/repo/src/routes/agents.ts`, lines 130 - 133
    - ** Category:** Reliability issues
      - ** Severity:** MEDIUM
        - ** Description:** All errors from `agentManager.create()` are returned as 400. Some failures(e.g., process spawn failures, filesystem errors) are 500 - class errors, not client input errors.
- ** Code:**
  ```ts
catch (err: unknown) {
  const message = err instanceof Error ? err.message : "Failed to create agent";
  res.status(400).json({ error: message });
}
```
  - ** Fix:** Differentiate between validation errors(400) and internal errors(500), or at minimum use 500 as the default and only use 400 for known validation cases.

---

### Finding 13 — DRY Violation: Repeated message - type validation list
  - ** File:** `/repo/src/routes/messages.ts`, lines 16, 57
    - ** Category:** DRY violations
      - ** Severity:** MEDIUM
        - ** Description:** The allowed message types list `["task", "result", "question", "info", "status", "interrupt"]` is duplicated in both`POST /api/messages` and`POST /api/messages/batch`.
- ** Code:**
  ```ts
// Line 16:
if (!type || !["task", "result", "question", "info", "status", "interrupt"].includes(type)) {
// Line 57:
if (!type || !["task", "result", "question", "info", "status", "interrupt"].includes(type)) {
```
  - ** Fix:** Extract to a module - level constant: `const VALID_MSG_TYPES = new Set(["task", "result", ...])` and use`VALID_MSG_TYPES.has(type)`.Also more efficient than`Array.includes()`.

---

### Finding 14 — DRY Violation: Repeated message validation logic in batch endpoint
  - ** File:** `/repo/src/routes/messages.ts`, lines 10 - 35 vs 51 - 71
    - ** Category:** DRY violations
      - ** Severity:** MEDIUM
        - ** Description:** The single - message`POST /api/messages` and the batch `POST /api/messages/batch` both validate`from`, `type`, `content`, and`content.length` with identical logic.The batch endpoint is a copy - paste of the single endpoint's validation wrapped in a loop.
          - ** Fix:** Extract a `validateMessageBody(body)` function returning `string | null`(error or null) and call it from both endpoints.

---

### Finding 15 — Magic numbers / strings
  - ** File:** `/repo/src/routes/messages.ts`, lines 24, 45, 67
    - ** Category:** Maintainability issues
      - ** Severity:** LOW
        - ** Description:** `50_000`(max content length) and`20`(max batch size) are inline magic numbers.
- ** Fix:** Extract as named constants: `const MAX_MESSAGE_CONTENT_LENGTH = 50_000; const MAX_MESSAGE_BATCH_SIZE = 20;`

---

### Finding 16 — Reliability: `clearContext` uses inconsistent HTTP status logic
  - ** File:** `/repo/src/routes/agents.ts`, lines 368 - 369
    - ** Category:** Reliability issues
      - ** Severity:** MEDIUM
        - ** Description:**
          ```ts
const httpStatus = result.status ? 409 : 404;
```
This checks`result.status`(a string like "running") as a truthy value to determine between 409 and 404. If `result.status` is an empty string or`undefined`, it falls through to 404. The logic is correct but fragile — it relies on the convention that `result.status` is only set for conflict cases.
- ** Fix:** Make the intent explicit: `const httpStatus = result.error?.includes('running') ? 409 : 404;` or better, have`clearContext` return a structured `{ ok, httpStatus, error }` object.

---

### Finding 17 — Code footprint: `cost.ts` `GET /api/cost/agent/:agentId` uses `.find()` instead of`.get()`
  - ** File:** `/repo/src/routes/cost.ts`, line 101
    - ** Category:** KISS violations
      - ** Severity:** LOW
        - ** Description:**
          ```ts
const agent = agentManager.list().find((a) => a.id === agentId);
```
            `agentManager.get(agentId)` exists and is used everywhere else.Using `.list().find()` is O(n) when O(1) lookup is available.
- ** Fix:** Replace with `agentManager.get(agentId)`.

---

### Finding 18 — Reliability: `syncClaudeHome().catch()` in config.ts fire - and - forget
  - ** File:** `/repo/src/routes/config.ts`, lines 241 - 243, 275 - 277, 420 - 422
    - ** Category:** Reliability issues
      - ** Severity:** MEDIUM
        - ** Description:** Three places call `syncClaudeHome().catch(...)` with only a`console.warn` in the catch handler.If the sync fails, the user gets `{ok: true}` but their config changes may not persist across restarts.This is silent data loss.
- ** Fix:** Either(a) await the sync and return an error / warning in the response body, or(b) add a `synced: false` field to the response when the sync fails, so the client can notify the user.

---

### Finding 19 — Over - complex: Verbose guardrails validation in config.ts
  - ** File:** `/repo/src/routes/config.ts`, lines 306 - 374
    - ** Category:** KISS violations / Code footprint
      - ** Severity:** MEDIUM
        - ** Description:** Seven nearly identical validation blocks: each extracts a value, casts to Number, checks`isInteger` and range, returns 400 on error, and calls a setter.This is ~70 lines of repetitive code.
- ** Code:**
  ```ts
if (maxPromptLength !== undefined) {
  const val = Number(maxPromptLength);
  if (!Number.isInteger(val) || val < 1000 || val > 1_000_000) {
    res.status(400).json({ error: "..." });
    return;
  }
  guardrails.setMaxPromptLength(val);
  updates.maxPromptLength = val;
}
// ... repeated 6 more times with different names/ranges
```
  - ** Fix:** Define a config array `[{key, min, max, setter}]` and loop over it.Cuts ~70 lines to ~15.

---

### Finding 20 — Reliability: No input sanitization on `mcp.ts` SETTINGS_PATH
  - ** File:** `/repo/src/routes/mcp.ts`, line 14
    - ** Category:** Maintainability issues
      - ** Severity:** LOW
        - ** Description:**
          ```ts
const SETTINGS_PATH = "/home/agent/.claude/settings.json";
```
This is a hardcoded path while `config.ts` uses `CLAUDE_HOME` from a utility.If the home directory ever changes, this path will break silently.
- ** Fix:** Use`path.join(CLAUDE_HOME, "settings.json")` for consistency.

---

### Finding 21 — Reliability: `cost.ts` summary computes `totalTokens` redundantly with usage endpoint
  - ** File:** `/repo/src/routes/cost.ts` vs`/repo/src/routes/usage.ts`
    - ** Category:** DRY violations
      - ** Severity:** MEDIUM
        - ** Description:** Both`GET /api/cost/summary` and `GET /api/usage/summary` compute per - agent token totals by iterating `agentManager.list()` and summing`usage.tokensIn + usage.tokensOut`.They use different shapes for the response, but the computation is duplicated.These two endpoints serve overlapping purposes.
- ** Fix:** Consider whether both endpoints are needed.If yes, extract a shared `computeAgentCostSummary(agents)` utility.If the usage endpoint is legacy, consider deprecating it.

---

### Finding 22 — AI artifact: Verbose JSDoc comments that restate the route
  - ** File:** `/repo/src/routes/cost.ts`, lines 6 - 12, 17 - 20, 62 - 64, 77 - 79, 96 - 98
    - ** Category:** AI artifacts / Useless inline comments
      - ** Severity:** LOW
        - ** Description:**
          ```ts
/**
 * Cost tracking route handler.
 *
 * Provides endpoints for tracking agent usage and costs.
 * Uses real token usage data from AgentManager for current session,
 * and CostTracker (SQLite) for persistent all-time history.
 */
```
The function-level docstring on `createCostRouter` is fine, but the per - route docstrings like `/** GET /api/cost/summary ... Returns aggregated cost... */` restate what the route path + handler code already conveys.
- ** Fix:** Keep the top - level docstring.Remove or condense per - route docstrings to one - liners if needed.

---

### Finding 23 — Reliability: `workflows.ts` module - level mutable state
  - ** File:** `/repo/src/routes/workflows.ts`, line 20
    - ** Category:** Reliability issues
      - ** Severity:** HIGH
        - ** Description:**
          ```ts
const workflows = new Map<string, LinearWorkflow>();
```
This is module - level mutable state outside the router factory function.If `createWorkflowsRouter` were ever called twice(e.g., in tests), both routers would share the same `workflows` map.More importantly, workflow data is entirely in -memory and lost on restart — there is no persistence layer.
- ** Fix:** Move the `workflows` Map inside `createWorkflowsRouter` so each router gets its own instance, or pass it as a dependency.Consider adding persistence(even a simple JSON file) if workflow status matters across restarts.

---

### Finding 24 — KISS violation: `buildManagerPrompt` is a 40 - line template string
  - ** File:** `/repo/src/routes/workflows.ts`, lines 60 - 103
    - ** Category:** KISS violations
      - ** Severity:** MEDIUM
        - ** Description:** A 40 - line markdown template string is embedded directly in the route file.This makes the route file harder to scan and the template harder to edit.
- ** Fix:** Move to a separate template file or a `templates/` module, consistent with the existing `src/templates/` directory.

---

### Finding 25 — Reliability: `server.ts` fallback route returns 200 for unknown paths
  - ** File:** `/repo/server.ts`, line 341
    - ** Category:** Reliability issues
      - ** Severity:** HIGH
        - ** Description:**
          ```ts
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(uiDistPath, "404.html"), (err) => {
    if (err) {
      res.status(200).send("AgentConductor API is running...");
    }
  });
});
```
When the 404.html file doesn't exist, the handler returns HTTP 200 with a plain text message. This means health checkers, crawlers, and integration tests see 200 for nonexistent routes. Also, when 404.html IS served, `sendFile` defaults to 200 — so the "404" page is served with a 200 status.
  - ** Fix:** Set`res.status(404)` before both the `sendFile` call and the fallback`.send()`.E.g.: `res.status(404).sendFile(...)` and`res.status(404).send(...)`.

---

### Finding 26 — Reliability: Missing `agentManager.get()` null check in `onIdle` callback
  - ** File:** `/repo/server.ts`, line 282
    - ** Category:** Reliability issues
      - ** Severity:** HIGH
        - ** Description:**
          ```ts
const agent = agentManager.get(agentId);
const pending = messageBus.query({
  to: agentId,
  unreadBy: agentId,
  agentRole: agent?.role,  // safe with ?.
});
```
The `agent` could be null if the agent was destroyed between the `canDeliver()` check and this line.While `agent?.role` handles this gracefully, the broader flow continues to attempt delivery to a potentially - destroyed agent.The `agentManager.message()` call on line 308 could throw.
- ** Fix:** Add an early return if `!agent` after the `.get()` call(remembering to call`deliveryDone` in that case).

---

### Finding 27 — Code footprint: `health.ts` is minimal and could merge with server.ts setup
  - ** File:** `/repo/src/routes/health.ts`
    - ** Category:** Code footprint reduction
      - ** Severity:** LOW
        - ** Description:** `health.ts` is only 55 lines containing a health endpoint and an auth token exchange endpoint.The auth endpoint(`POST /api/auth/token`) is semantically unrelated to health checks and is only in this file because both are exempt from the recovery middleware.
- ** Fix:** This is minor, but consider renaming to `core.ts` or `bootstrap.ts` to reflect that it holds bootstrap - exempt routes, not just health.Or split auth into its own file.

---

## Cross - cutting Observations

### What's done well:
1. ** Consistent router factory pattern ** — Every route file exports a `createXRouter(deps)` function that returns an Express Router.Clean dependency injection.
2. ** Input validation ** — Most endpoints validate inputs thoroughly with specific error messages.
3. ** Security checks ** — Kill switch bypass prevention, agent - service token restrictions, XSS headers, symlink checks, path traversal prevention in context.ts.
4. ** Separation of concerns ** — Routes are thin handlers that delegate to service - layer objects(AgentManager, MessageBus, TaskGraph, etc.).
5. ** SSE implementation ** — The message stream in messages.ts handles cleanup, heartbeats, and destroyed connections properly.

### Recommended priority order for fixes:
  1. ** HIGH ** — Finding 25(404 returns 200) — Quick fix, prevents real confusion
2. ** HIGH ** — Finding 3(agent - service guard middleware) — Reduces ~40 lines across 6 files
3. ** HIGH ** — Finding 26(null check in onIdle) — Prevents potential runtime crash
4. ** HIGH ** — Finding 23(module - level state in workflows) — Architectural concern
5. ** MEDIUM ** — Finding 4(console vs logger) — Mechanical fix, big impact on log consistency
6. ** MEDIUM ** — Finding 19(guardrails validation) — Nice code reduction
7. ** MEDIUM ** — Finding 14(message validation DRY) — Clean up
