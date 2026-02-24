# Plan: Local Docker Run and npx “Just Run It”

**Goal:** Run AgentManager locally with one command (e.g. `npm run docker:local` or eventually `npx @org/agent-manager`), no GCP required. Persistent repos, shared memory, and logs work via local volumes.

---

## 1. Vision Summary

| What | How |
|------|-----|
| **Single npm command** | `npm run docker:local` → `docker compose up --build` with one volume for all persistence. |
| **No GCP** | Leave `GCS_BUCKET` unset; GCS sync and GCS kill-switch poll are already no-ops. |
| **Persistent repos** | One Docker volume mounted at `/persistent`; repo list = filesystem (`/persistent/repos/*.git`). |
| **Worktrees & branching** | Unchanged: agents create worktrees under their workspace; GC prunes stale ones; no app-level limit beyond Git. |
| **Shared memory** | `SHARED_CONTEXT_DIR=/persistent/shared-context`; no GCS, file-based only. |
| **Logs** | Server → stdout; agent events → `/persistent/agent-events/*.jsonl` when `/persistent` is mounted. |
| **npx someday** | Thin wrapper: default = run Node app (no Docker); `--docker` = pull image and run container. |

---

## 2. GCP-Free Local Mode (Already Supported)

**Finding:** Core “run agents + UI” already works without GCP.

- **Required env:** `JWT_SECRET`, `API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `SHARED_CONTEXT_DIR` (e.g. `./shared-context` or `/persistent/shared-context`).
- **Unset:** `GCS_BUCKET` → storage sync, GCS kill-switch poll, and GCS cleanup are no-ops.
- **Persistence:** When `/persistent` is missing, code uses `/tmp` for state, events, messages, task-graph; when `/persistent` is mounted (e.g. Docker volume), everything persists under `/persistent`.

**Optional local-mode tweaks (later):**

- Env override for repos dir when not using `/persistent` (e.g. `PERSISTENT_REPOS` or “repos dir” from env).
- Document local mode in README (Docker only; no non-Docker run).

---

## 3. Persistent Repos and Worktrees

**Repo list:** No separate DB; list = **filesystem**: `readdir(PERSISTENT_REPOS)` filtered to `*.git` dirs. So the “persistent map” is just the contents of `/persistent/repos`.

**Flow:**

- **Bare repos:** Created via POST `/api/repositories` → `git clone --bare` into `/persistent/repos/<name>.git`.
- **Worktrees:** Created by agents (e.g. `git -C repos/repo.git worktree add ../repo-workdir main`). `workspaceDir/repos` is a symlink to `/persistent/repos`, so worktrees live under each agent’s `/tmp/workspace-{uuid}/`.
- **Cleanup:** On agent destroy → `cleanupWorktreesForWorkspace`; on startup → `worktree prune` in entrypoint; every 10 min → `startWorktreeGC` prunes worktrees for non-active workspaces.

**Large swarms:**

- Up to 100 agents (guardrails); no app-level limit on worktrees per repo.
- One worktree per (agent, repo, path); multiple branches = distinct worktree names (e.g. `../repo-main`, `../repo-feature-x`).
- GC is O(repos × worktrees) every 10 min; Git lock files prevent races; no batching today.

**For local Docker:** Mount one volume at `/persistent` so `/persistent/repos`, `/persistent/shared-context`, agent state, events, and messages all persist. No code change needed.

---

## 4. Shared Memory and Logs

**Shared context:**

- Read/write via `SHARED_CONTEXT_DIR` (default `/shared-context`; when `/persistent` is mounted—e.g. Docker volume or FUSE—entrypoint sets `/persistent/shared-context`).
- With no `GCS_BUCKET`: no sync; all file-based. For local Docker, use `SHARED_CONTEXT_DIR=/persistent/shared-context` and mount `/persistent`.

**Logs:**

- **Server:** stdout/stderr only (JSON in production, human-readable in dev); no in-app rotation.
- **Agent “logs”:** Event stream persisted under `EVENTS_DIR` = `/persistent/agent-events` or `/tmp/agent-events`; one `{agentId}.jsonl` per agent; no rotation (removed when agent is destroyed).

**Messages:**

- MessageBus: `/persistent/messages.jsonl` or `/tmp/messages.jsonl`; 500 ms debounced write; no GCS.

**Volume for local Docker:** Single mount `./data/persistent:/persistent` (or named volume `agent-manager-data:/persistent`) gives repos, shared-context, agent-state, agent-events, messages, MCP tokens, and pnpm store in one place.

---

## 5. Docker Compose and One npm Command

**docker-compose.yml (repo root):**

- **Service:** `agent-manager`, build from existing Dockerfile, image `agent-manager:local`, port `8080:8080`.
- **Env:** `env_file: .env`; override `PORT=8080`, `SHARED_CONTEXT_DIR=/persistent/shared-context`; do **not** set `GCS_BUCKET`.
- **Volumes:** Single named volume `agent-manager-data:/persistent`.
- Optional: volume for `/tmp/platform` if kill-switch state should survive restarts.

**Minimal `.env` for local:**

- `API_KEY=dev-test-key` (or stronger)
- `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=sk-or-v1-...`
- Optional: `JWT_SECRET=local-dev-secret` (else entrypoint generates ephemeral one).

**package.json scripts:**

- `docker:local` → `docker compose up --build`
- `docker:local:down` → `docker compose down`
- Optional: `docker:local:logs` → `docker compose logs -f`

**Result:** One command (`npm run docker:local`) builds and runs the app at http://localhost:8080 with full persistence under `/persistent`.

---

## 6. npx “Just Run It” (Future)

**Package options:** `@org/agent-manager` or `create-agent-manager`, single bin.

**Mode:** Docker only. Running outside Docker is not supported. A future npx wrapper would run the Docker image (e.g. `npx @org/agent-manager` → pull image and `docker run`).

**Docker flow:**

- Image: e.g. `ghcr.io/org/agent-manager:latest`.
- Wrapper: check `docker` → pull image → `docker run -p 8080:8080` with env (API_KEY, ANTHROPIC_AUTH_TOKEN) and optional volume (e.g. `$(pwd)/.agent-manager/shared-context:/persistent/shared-context` or named volume).

**First-run UX:**

- Print: “AgentManager is running at http://localhost:8080”
- “Log in with API_KEY (set in .env or export).”
- “Set ANTHROPIC_AUTH_TOKEN for agent runs.”
- Option: start with default `API_KEY=dev-first-run` and warn, or require API_KEY.

---

## 7. Implementation Phases

**Phase 1 – Local Docker (minimal code)**

1. Add `docker-compose.yml`: one service, build from Dockerfile, port 8080, env_file + SHARED_CONTEXT_DIR, single volume at `/persistent`.
2. Add npm scripts: `docker:local`, `docker:local:down`, optionally `docker:local:logs`.
3. Document in README or `docs/docker-local.md`: copy `.env.example`, set API_KEY and ANTHROPIC_AUTH_TOKEN, do not set GCS_BUCKET; run `npm run docker:local`.

**Phase 2 – Docs and defaults**

4. README: Docker-only quick start, minimal env, link to docker-local.
5. Optional: `.env.docker.example` with only local-needed vars.

**Phase 3 – Optional repo path override**

6. (Optional) Env override for repos dir when not using `/persistent` is out of scope—running outside Docker is not supported.

**Phase 4 – npx wrapper (later)**

7. New package or bin: CLI that runs the Docker image (e.g. `npx @org/agent-manager` → pull image and `docker run`). No non-Docker run.
8. Publish to npm; document first-run steps.

---

## 8. Verification and plan of action

**Verification (codebase check):** The plan was verified against the repo. GCP-free mode (unset `GCS_BUCKET`), persistence paths (`/persistent` vs `/tmp`), repos/worktrees (readdir, clone --bare, symlink, GC), and existing `docker-compose.yml` + npm scripts all match. No hallucinations; one wording fix applied in §4 (FUSE → “when /persistent is mounted”).

**Plan of action (easy for non-technical users):**

- **Phase 1 (done):** `docker-compose.yml` and npm scripts `docker:local`, `docker:local:down`, `docker:local:logs` already exist. One-command run: `npm run docker:local`.
- **Phase 2 (implement):** Docs and README so anyone can run without GCP:
  - **Prerequisites:** Explain what Docker is and how to get it (Docker Desktop for Mac/Windows, Docker Engine for Linux); how to check (`docker --version`). For later npx: Node.js from nodejs.org and `npx --version`.
  - **Run with Docker:** Copy `.env.example` → `.env`, set `API_KEY` and `ANTHROPIC_AUTH_TOKEN`, do not set `GCS_BUCKET`, run `npm run docker:local`, open http://localhost:8080. Data persists in a Docker volume.
  - **Troubleshooting:** “Docker not found” → Prerequisites; port 8080 in use → change PORT; login fails → check API_KEY.
  - **First-run message:** Server (and optionally entrypoint) prints “AgentManager is running at http://localhost:8080 — log in with your API_KEY from .env.”
- **Concrete task list and file changes:** See [local-docker-phase1-2-implementation.md](./local-docker-phase1-2-implementation.md).
- **Phase 4 (later):** npx “just run it” and optional `--docker`; not in this implementation.

---

## 9. References

- **GCP touchpoints:** `src/storage.ts`, `src/kill-switch.ts`, `server.ts`, `entrypoint.sh`; persistence/messages/task-graph under `src/`.
- **Repos/worktrees:** `src/paths.ts`, `src/worktrees.ts`, `src/workspace-manager.ts`, `src/routes/repositories.ts`, `src/agents.ts`.
- **Shared context / logs / messages:** `src/utils/context.ts`, `src/routes/context.ts`, `src/storage.ts`, `src/logger.ts`, `src/persistence.ts`, `src/messages.ts`.

Sub-agent reports that informed this plan: GCP dependencies, repos/worktrees, shared-context/logs/messages, Docker Compose + npm scripts, npx distribution design.
