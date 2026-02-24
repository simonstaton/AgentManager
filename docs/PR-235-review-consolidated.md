# PR #235 Review (simon/improve_local_runs) — Consolidated

Review used 5 sub-agents (Docker/entrypoint, Docs, Secrets/config, Server/repos, UI/API). Findings below are verified against the codebase; hallucinations and duplicate points were removed.

---

## Summary

- **Scope:** Local Docker as only run path, docs, encrypted secrets store, Settings integrations, per-repo PATs, git credentials in agent workspaces.
- **Verdict:** Plan adherence is strong. A few factual issues and one security fix are called out; optional improvements are listed at the end.

---

## 1. Docker & entrypoint

- **docker-compose.yml** (new in PR): Matches plan — service `agent-manager`, build `.`, Dockerfile, image `agent-manager:local`, port `8080:8080`, `env_file: .env`, `environment`: `PORT`, `SHARED_CONTEXT_DIR` (no `GCS_BUCKET`), volume `agent-manager-data:/persistent`. No issues.
- **entrypoint.sh**: Only change is the startup echo (persistent storage + UI URL). Logic unchanged.
- **Plan §5 (mountpoint):** Entrypoint still requires `[ -d /persistent ] && mountpoint -q /persistent`. On some Docker setups a named volume may not satisfy `mountpoint -q`, so the persistent block (mkdirs, worktree prune, pnpm config) may be skipped. Compose already sets `SHARED_CONTEXT_DIR`, so shared-context works; repos/pnpm/worktree init could be affected. Plan’s optional fallback (“when `[ -d /persistent ]` only”) is not implemented — consider adding if users hit missing dirs.

---

## 2. Docs & README

- **README:** Prerequisites (Docker + install links), Quick Start Docker-only, link to `docs/docker-local.md` — all present. No non-Docker run in Quick Start.
- **docs/docker-local.md:** One-command run, .env steps, “Open http://localhost:8080”, Troubleshooting, “Don’t have it?” under Prerequisites — all present.
- **Missing vs plan:** Plan §3 asks: *“If you don't have Docker, see [Prerequisites](../README.md#prerequisites) in the README.”* That exact link to README’s Prerequisites is **not** in `docs/docker-local.md`; the doc only has in-doc Prerequisites. Adding one sentence with that link would satisfy the plan.
- Links/anchors checked: README → docker-local, docker-local → #prerequisites, README #prerequisites — all valid.

---

## 3. Secrets store & config

- **Encryption:** Key from `SECRETS_ENCRYPTION_KEY` (hex or sha256) or `JWT_SECRET` (scrypt). No key rotation or backup; changing key makes existing `secrets.enc` undecryptable; `loadFromDisk()` returns `{}` and logs a warn, so operators don’t get a clear “wrong key” signal.
- **repo-credentials.ts:** `credentialLine` returns non-empty only for `https:` URLs; SSH/invalid URLs yield `""`. `.git-credentials` written with `mode: 0o600`. No issues.
- **config.ts:** GET `/api/settings` is store-first then env for anthropic and integrations. PUT `/api/settings/integrations` uses `requireHumanUser` and only allows the listed keys. No issues.

---

## 4. Server startup & repositories

- **server.ts:** `loadSecretsIntoEnv()` at startup in try/catch with warn log. Listen callback logs “Open http://localhost:${PORT}…”. Good.
- **agents.ts:** Create uses `getRepoCredentialsForAgents().then(writeGitCredentialsFile).catch(...)` (not awaited) and `buildEnv(id, workspaceDir)`. Resume uses `buildEnv(id, agentProc.agent.workspaceDir)`. **Race:** The child can start before `.git-credentials` is written; first git use might miss credentials. Low impact; consider awaiting the credential write before spawn if desired.
- **repositories.ts:** Clone uses `getGitHubTokenForClone()`; token only injected for HTTPS GitHub; SSE uses `displayUrl` (redacted). **Security:** `trimmedUrl` (which can contain the PAT) is logged in three places: `logger.info` (success), `logger.error` (exit code), `logger.error` (process error). Should log `displayUrl` (or a redacted URL) instead of `trimmedUrl` so the PAT never appears in logs.

---

## 5. UI & API

- **API:** `setIntegrations` and `setRepositoryPat` use correct endpoints and body shapes. `Repository` has `patConfigured`. Integrations and Repositories panels and routes are wired correctly.
- **Error handling:** For `setIntegrations` and `setRepositoryPat`, on `!res.ok` the client throws a fixed message and does not read `res.json()`, so the server’s `error` field (e.g. “Failed to save API key securely”) is never shown. Optional: use `res.json().catch(() => ({}))` and `(data as { error?: string }).error` like other endpoints (e.g. `deleteRepository`) for better UX.

---

## Fixes applied in this pass

1. **Security:** Use redacted URL in repository clone logs (see code change).
2. **Plan compliance:** Add “If you don’t have Docker, see [Prerequisites](../README.md#prerequisites) in the README.” to `docs/docker-local.md`.

---

## Optional follow-ups (not blocking)

- Entrypoint: add fallback when `[ -d /persistent ]` but not mountpoint (plan task 4).
- Secrets: consider distinguishing “no file” vs “decrypt failed” (e.g. different log or metric).
- Agent create: await credential write before spawn to avoid race.
- UI: surface server error message for `setIntegrations` and `setRepositoryPat`.
