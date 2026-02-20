# Security Remediation Plan — 2026-02-20 Audit

> **Source:** Full audit report at `shared-context/audit-2026-02-20.md`  
> **Audited commit:** `61d39ad`  
> **Summary:** 3 CRITICAL · 12 HIGH · 8 MEDIUM · 5 LOW (backend) + 4 LOW (UI) + 5 HIGH (infra, unverified)

This document translates every finding into a concrete implementation task, grouped into milestones by urgency.

---

## Milestone 1 — Critical (fix before next deploy)

### Task 1.1 — Authenticate the message bus (`src/routes/messages.ts`)
**Finding:** CRIT-1  
**What to do:**
1. Add `router.use(authMiddleware)` as the first line of `routes/messages.ts`.
2. Scope `GET /api/messages` to return only messages `to` or `from` the requesting agent's ID (`req.user.sub`). Operator tokens (non-`agent-service`) may read all.
3. Add a guard to `DELETE /api/messages` rejecting `agent-service` tokens.
4. Add integration tests: unauthenticated POST → 401, agent token GET → only own messages, operator token GET → all messages.

### Task 1.2 — Fix dead scheduler auth guard (`src/routes/scheduler.ts`)
**Finding:** CRIT-2  
**What to do:**
1. Replace every occurrence of `authReq.tokenType === "agent-service"` with `authReq.user?.sub === "agent-service"`.
2. Add `tokenType` to `AuthenticatedRequest` in `src/types.ts` **only if** the field is genuinely populated by `authMiddleware`; otherwise remove all references to it.
3. Add a unit test: agent token calling `POST /api/scheduler/jobs` → 403.

### Task 1.3 — Block SSRF in webhook scheduler jobs (`src/scheduler.ts`)
**Finding:** CRIT-3  
**What to do:**
1. Before `sendWebhook(url, ...)`, validate the URL:
   - Parse with `new URL(url)` inside try/catch (invalid URL → skip + log error).
   - Reject `http:` scheme (allow only `https:`).
   - Reject hostnames that resolve to RFC-1918 (`10.x`, `172.16–31.x`, `192.168.x`) or loopback (`127.x`, `::1`), and GCP metadata (`169.254.169.254`, `metadata.google.internal`).
2. Apply the same validation in the API layer at `POST /api/scheduler/jobs` when `type === "webhook-notify"`.
3. Add unit tests for each blocked pattern.

---

## Milestone 2 — High Severity (fix within current sprint)

### Task 2.1 — Validate JWT `alg` field and fix `timingSafeEqual` (`src/auth.ts`)
**Findings:** HIGH-1, HIGH-2  
**What to do:**
1. In `verifyJwt`, after decoding the header, add:
   ```typescript
   if (header.alg !== "HS256") throw new Error("Unexpected JWT algorithm");
   ```
2. Change signature comparison to compare raw decoded bytes:
   ```typescript
   const expected = Buffer.from(expectedSig, "base64url");
   const actual   = Buffer.from(actualSig,   "base64url");
   if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw ...;
   ```
3. Rename the `apiKey` parameter in `exchangeKeyForToken` to `inputApiKey` to avoid shadowing.

### Task 2.2 — Fix rate limiter IP extraction (`src/validation.ts`)
**Finding:** HIGH-3  
**What to do:**
1. Replace `req.headers['x-forwarded-for']?.split(',')[0]` with the rightmost trusted proxy IP or `req.socket.remoteAddress`.
2. If the platform always terminates TLS at a single Cloud Run proxy, `req.socket.remoteAddress` is correct and removes the `X-Forwarded-For` dependency entirely.

### Task 2.3 — Add bounds validation to guardrail setters (`src/guardrails.ts`)
**Findings:** HIGH-4, HIGH-5  
**What to do:**
1. Add min/max checks to `setMaxAgents` (1–500), `setMaxCostUsd` (0.01–10000), `setMaxTokensPerMinute`, and all other numeric setters.
2. Canonicalize paths in the `rm` guardrail check with `path.resolve()` before applying the whitelist regex.

### Task 2.4 — Sanitize agent name/role before CLAUDE.md injection (`src/templates/workspace-claude-md.ts`)
**Finding:** HIGH-10  
**What to do:**
1. At agent creation time, validate that `name` and `role` match `/^[a-zA-Z0-9 _\-]{1,64}$/`.
2. Also sanitize `contextIndex` summary content: strip lines beginning with `#` (Markdown headers) to prevent header injection.
3. Apply the same rule to any `shared-context` file summaries injected into the template.

### Task 2.5 — Harden MCP OAuth (`src/mcp-oauth-manager.ts`, `src/mcp-oauth-storage.ts`)
**Findings:** HIGH-11, HIGH-12, MED-6  
**What to do:**
1. Replace `req.headers.host` in `getCallbackUrl()` with `process.env.PUBLIC_BASE_URL`.
2. Sanitize `serverName` to `/^[a-zA-Z0-9_-]{1,64}$/` before using in file paths.
3. Write token files with `{ mode: 0o600 }`.
4. Add a cleanup interval that deletes `pendingStates` entries older than 10 minutes and cap the map at 1000 entries.

### Task 2.6 — Fix GCS path traversal and silent write drops (`src/storage.ts`)
**Findings:** HIGH-7, HIGH-8, MED-7  
**What to do:**
1. In `downloadDir`, after computing the local target path from the GCS object name, assert `resolvedLocal.startsWith(resolvedBase + path.sep)`.
2. Replace the `syncInProgress` boolean with a promise-queue: callers await the in-flight sync before starting a new one (no data loss).
3. Pass `{ recursive: true }` to `fs.watch` or switch to `chokidar` for reliable cross-platform recursive watching.

### Task 2.7 — Fix workspace attachment path traversal (`src/workspace-manager.ts`)
**Finding:** HIGH-9  
**What to do:**
1. After computing the attachment target path, assert it starts with `path.resolve(workspaceDir) + path.sep`.

---

## Milestone 3 — Medium Severity (fix within next two sprints)

### Task 3.1 — Fix `process.env = undefined` and command path traversal (`src/routes/config.ts`)
**Findings:** MED-3, MED-4  
**What to do:**
1. Replace `process.env.ANTHROPIC_AUTH_TOKEN = undefined` with `delete process.env.ANTHROPIC_AUTH_TOKEN` (and same for `ANTHROPIC_BASE_URL`).
2. After computing `commandPath`, add: `if (!path.resolve(commandPath).startsWith(path.resolve(CLAUDE_HOME, "commands") + path.sep)) return res.status(400)...`
3. Explicitly reject command names that start with `/`.

### Task 3.2 — Block agent self-approval of grades and task deletion (`src/routes/tasks.ts`)
**Findings:** MED-5, LOW-3  
**What to do:**
1. Add `if (req.user?.sub === "agent-service") return res.status(403).json({error: "Agent tokens cannot approve grades"})` at the top of `POST /api/grades/:taskId/approve`.
2. Add the same guard to `DELETE /api/tasks`.

### Task 3.3 — Implement `getNextRunDate` and fix stale job closures (`src/scheduler.ts`)
**Findings:** MED-1, MED-2  
**What to do:**
1. Implement `getNextRunDate` using `cron-parser` (already in package.json or add it) to enable missed-execution recovery.
2. Change cron callbacks to re-read the job from `this.jobStore.get(job.id)` on each fire rather than closing over the snapshot.

### Task 3.4 — Enforce `MAX_DEPENDENCIES` and fix `retryTask` (`src/task-graph.ts`)
**Findings:** MED-8, LOW-4  
**What to do:**
1. Add `if (dependencies.length > MAX_DEPENDENCIES) throw new RangeError(...)` in `addTask`.
2. After transitioning a task to `pending` in `retryTask`, iterate dependents and call `unblockTask` for those whose remaining blockers are all satisfied.

### Task 3.5 — Secrets cache TTL and key-rotation hook (`src/sanitize.ts`)
**Finding:** HIGH-6  
**What to do:**
1. On `PUT /api/settings/anthropic-key` success, emit an event or call `sanitize.resetCache()`.
2. Add a TTL to cache entries (e.g., 5 minutes) so stale data is never used indefinitely.

---

## Milestone 4 — Low Severity / UI (next backlog cycle)

### Task 4.1 — Health endpoint metric gating (`src/routes/health.ts`)
Return `{"status":"ok","timestamp":"..."}` unauthenticated. Move `containerMB`, `heapUsedMB`, agent counts to an authenticated `/api/status` endpoint.

### Task 4.2 — Fix HTTP 200 on 404 fallback (`src/server.ts`)
`res.status(404).sendFile(path.join(uiDistPath, "404.html"), ...)`

### Task 4.3 — Move JWT to `httpOnly` cookie (`ui/src/auth.tsx`)
Issue JWT as `Set-Cookie: jwt=...; HttpOnly; Secure; SameSite=Strict` from the `/api/auth/token` endpoint. Remove `sessionStorage.getItem/setItem("jwt")` from the UI.

### Task 4.4 — Fix `actionInFlight` ref used for disabled state (`ui/src/views/TasksView.tsx`)
Replace `disabled={actionInFlight.current}` with `disabled={busyAction !== null}`.

### Task 4.5 — Implement navigation blocker for unsaved changes (`ui/src/views/Settings.tsx`)
Implement `blocker.state` updating on route change using Next.js App Router navigation interceptor, or remove the dead code and dialogs that depend on it.

---

## Milestone 5 — Infrastructure (separate infra PR)

### Task 5.1 — `Dockerfile`: Pin `gh` CLI with checksum verification
Download the binary and verify SHA256 against the official release checksums before `chmod +x`.

### Task 5.2 — `entrypoint.sh`: Remove `KEY_SUFFIX` from startup log output
Ensure no API key material (even suffixes) appears in stdout/stderr that could be captured by Cloud Logging.

### Task 5.3 — `terraform/iam.tf`: Scope IAM roles per-service
Replace project-wide `roles/run.developer` grant with per-service binding. Remove service account self-impersonation.

### Task 5.4 — `.trivyignore`: Add expiry dates to all CVE suppressions
Each entry should have a comment with the suppression rationale and a review date (e.g., `# expires 2026-05-01`).

---

## Suggested PR/Issue Structure

Each milestone can become a single PR. Suggested branch names:

| Milestone | Branch |
|-----------|--------|
| 1 | `fix/security-critical-auth-ssrf` |
| 2 | `fix/security-high-jwt-traversal-oauth` |
| 3 | `fix/security-medium-scheduler-tasks` |
| 4 | `fix/security-low-health-ui-jwt` |
| 5 | `fix/infra-dockerfile-iam` |

Each PR description should reference the finding IDs from `shared-context/audit-2026-02-20.md`.

---

*Plan authored by agent-ab488176, 2026-02-20, based on 10-domain LLM-as-judge audit of commit `61d39ad`.*
