# Phase 1 & 2 Implementation Plan: Local Docker + Docs

Concrete implementation plan for **Phase 1 (Local Docker)** and **Phase 2 (Docs and defaults)** from [local-docker-and-npx.md](./local-docker-and-npx.md), sections 5 and 7. **Docker is the only supported way to run AgentManager;** do not suggest or document running outside Docker. Phase 4 (npx) would wrap Docker only.

---

## 1. Task list (ordered)

**Status:** Tasks 1–2 are already done (docker-compose.yml and npm scripts exist and match the plan). Remaining work: docs, README, optional server/entrypoint message.

1. **docker-compose.yml** ✅ (done) – Ensure `docker-compose.yml` at repo root defines one service: **name `agent-manager`**, **build context `.`**, **dockerfile `Dockerfile`**, **image `agent-manager:local`**, **port `8080:8080`**. Use **env_file: `.env`** and **environment** overrides: `PORT=8080`, `SHARED_CONTEXT_DIR=/persistent/shared-context`; do **not** set `GCS_BUCKET`. Use a single **named volume**: **name `agent-manager-data`**, **mount path `/persistent`** in the container. (Optional: volume for `/tmp/platform` only if kill-switch state should survive restarts; plan leaves this optional.)

2. **npm scripts** ✅ (done) – Ensure **package.json** has: **`docker:local`** → `docker compose up --build`; **`docker:local:down`** → `docker compose down`; **`docker:local:logs`** → `docker compose logs -f`.

3. **Minimal .env for local Docker** – Document (and optionally provide a template) that local Docker needs at least: **`API_KEY`** (e.g. `dev-test-key` or stronger), **`ANTHROPIC_BASE_URL`** (e.g. `https://openrouter.ai/api`), **`ANTHROPIC_AUTH_TOKEN`** (e.g. OpenRouter `sk-or-v1-...`). **Do not set `GCS_BUCKET`**. Optional: **`JWT_SECRET`** (if unset, entrypoint generates an ephemeral one). Optional: **`.env.docker.example`** with only these local-needed vars for copy-paste.

4. **Code support for /persistent** – No structural code change required. The codebase already uses `/persistent` when present (entrypoint.sh creates dirs and sets `SHARED_CONTEXT_DIR` when `/persistent` is a mountpoint; persistence, messages, events, repos, task-graph, dep-cache all use `/persistent` or fallback to `/tmp`). **Compose overrides `SHARED_CONTEXT_DIR=/persistent/shared-context`** so shared-context works even if entrypoint's mountpoint check behaves differently in Docker. If in testing the entrypoint does not create `/persistent/*` subdirs under a Docker volume, add in entrypoint (inside the "persistent" block) a fallback: when `[ -d /persistent ]` (and optionally not mountpoint), still run `mkdir -p /persistent/repos ...` and `export SHARED_CONTEXT_DIR=...` so local Docker without `mountpoint` still works. (Ambiguity: plan assumes "volume mount" is sufficient; some environments may not report it as a mountpoint.)

5. **Non-technical terminal output** – Ensure users see a clear "open this URL" message. Either: (a) add a single startup log line in **server.ts** after listening (e.g. "Open http://localhost:8080 in your browser") so it appears in `docker compose up` output, or (b) document in README and `docs/docker-local.md` that after "AgentManager listening on :8080" they should open **http://localhost:8080**. Prefer (a) for one-command UX.

6. **docs/docker-local.md** – Create a short doc: copy `.env.example` to `.env` (or use `.env.docker.example` if added), set `API_KEY` and `ANTHROPIC_AUTH_TOKEN`, do not set `GCS_BUCKET`, run `npm run docker:local`, then open http://localhost:8080. Include link to Prerequisites (Docker install) and "if you don't have Docker" below.

7. **README: Prerequisites (Docker)** – Add a short **Prerequisites** section (or subsection under Quick Start / Docker): "You need Docker. Don't have it? [Install Docker Desktop](https://docs.docker.com/desktop/install/) for Mac/Windows or [Docker Engine](https://docs.docker.com/engine/install/) for Linux." Keep it brief; a later pass can expand.

8. **README: Quick Start (Docker only)** – Quick Start is the one-command Docker flow only: minimal env, no `GCS_BUCKET`, link to **docs/docker-local.md**. No non-Docker run.

9. **Optional: one-line Docker install hint** – In README Prerequisites or in `docs/docker-local.md`, one line: e.g. "Requires Docker installed ([Mac/Windows](https://docs.docker.com/desktop/install/) | [Linux](https://docs.docker.com/engine/install/))." No need to duplicate long instructions; link only.

---

## 2. File change list

| Action | File |
|--------|------|
| **Create** | `docs/docker-local.md` – one-command Docker instructions, minimal .env, link to Prerequisites, "open http://localhost:8080", what to do if Docker is missing. |
| **Edit** | **README.md** – Add Prerequisites (Docker + install links). Under "Quick Start" or "Alternative: Docker (Local)", replace or augment the current `docker build`/`docker run` block with: "Copy `.env.example` to `.env`, set `API_KEY` and `ANTHROPIC_AUTH_TOKEN`, do not set `GCS_BUCKET`, run `npm run docker:local`. Open http://localhost:8080." Link to `docs/docker-local.md`. |
| **Verify/Edit** | **docker-compose.yml** – Already present; verify service name `agent-manager`, build context `.`, port `8080:8080`, `env_file: .env`, `environment` (PORT, SHARED_CONTEXT_DIR; no GCS_BUCKET), volume `agent-manager-data:/persistent`. |
| **Verify** | **package.json** – Scripts `docker:local`, `docker:local:down`, `docker:local:logs` already exist; no change unless naming differs from plan. |
| **Edit (optional)** | **.env.example** – Add a short comment that for local Docker, do not set `GCS_BUCKET` and that `SHARED_CONTEXT_DIR` is overridden in compose. Optional: add **.env.docker.example** with only `API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and optional `JWT_SECRET`. |
| **Edit (optional)** | **server.ts** – Add one log line after listening: e.g. "Open http://localhost:8080 in your browser" (using `PORT` from env) so the one-command run prints the URL. |

No new files beyond `docs/docker-local.md` and optional `.env.docker.example`. Phase 4 (npx) is not implemented here.

---

## 3. Non-technical UX

- **When the user runs the one command** (`npm run docker:local`):
  - They should see the server start and a clear instruction to open the app. **Target:** terminal shows something like "Open http://localhost:8080 in your browser" (either from a new server log line or from docs). Current behavior: "AgentManager listening on :8080" only; adding the URL line improves UX.
- **If they don't have Docker:**
  - Show or link to a **Prerequisites** section: "You need Docker. Don't have it? Install Docker Desktop (Mac/Windows) or Docker Engine (Linux)." Link to official install docs (see section 4). `docs/docker-local.md` should say: "If you don't have Docker, see [Prerequisites](../README.md#prerequisites) in the README."
- **One-line "install Docker" hint:**
  - Either in README Prerequisites only, or one line in `docs/docker-local.md`: "Requires Docker ([install links](#prerequisites))." The third agent may expand the Prerequisites section later.

---

## 4. Prerequisites section (short draft for README)

Use this as the Prerequisites block (or first subsection under "Alternative: Docker (Local)"):

```markdown
### Prerequisites

You need Docker. Don't have it? [Install Docker Desktop](https://docs.docker.com/desktop/install/) for Mac/Windows or [Docker Engine](https://docs.docker.com/engine/install/) for Linux.
```

Optional follow-up line: "Then copy `.env.example` to `.env`, set `API_KEY` and `ANTHROPIC_AUTH_TOKEN`, and run `npm run docker:local`."

---

## 5. Ambiguities / notes from the plan

- **entrypoint and `/persistent`:** The entrypoint currently requires `[ -d /persistent ] && mountpoint -q /persistent`. On some Docker setups a named volume may not satisfy `mountpoint -q`. Compose already overrides `SHARED_CONTEXT_DIR`, so shared-context works; if repo list or other features fail, consider relaxing the entrypoint to treat "directory exists" as sufficient for local Docker (task 4).
- **Optional volume for `/tmp/platform`:** Section 5 mentions an optional volume for kill-switch state; this plan leaves it out unless Phase 2 explicitly adds it.
- **Phase 4 (npx):** Not in scope; reference only as "later" (e.g. "A future npx-based run is planned.") in README or docker-local doc if desired.

---

## 6. Summary

- **Phase 1:** docker-compose (service `agent-manager`, volume `agent-manager-data:/persistent`), npm scripts, minimal .env docs; optional server log line for "Open http://localhost:8080".
- **Phase 2:** README Prerequisites (Docker + install links), README "run without GCP" + link to `docs/docker-local.md`, new `docs/docker-local.md`; optional `.env.docker.example`.
- **No Phase 4:** npx wrapper is not implemented or specified here.
