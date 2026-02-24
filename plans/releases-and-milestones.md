# Plan: Releases and Milestone Artifacts

**Goal:** Have actual releases with a publishable artifact (Docker image and supporting docs) so people can consume specific milestones. Versioned image tags, optional public registry, and a repeatable release process.

---

## 1. Vision Summary

| What | How |
|------|-----|
| **Release artifact** | Docker image tagged by version (e.g. `v2.1.0`, `2.1.0`) plus existing SHA and `latest`. |
| **Version source** | Semver in `package.json`; git tags `v<major>.<minor>.<patch>` mark the released commit. |
| **Public consumption** | Image published to a public registry (GHCR or Docker Hub) so anyone can `docker pull` without GCP. |
| **Milestone** | Agreed scope merged to `main`, checks green; we choose to publish a named release and run the process. |
| **User experience** | One-line run command, docker-compose snippet, `.env.example`, and short "Quick start" in README/release notes. |

---

## 2. Current State (Summary)

**Version:** Only in root `package.json` (`"version": "2.0.0"`). Not used in image tags, CI, or runtime (health API has no version).

**Deploy flow:**

- **Trigger:** Manual only — `workflow_dispatch` on `.github/workflows/deploy.yml`; typically via `gh workflow run deploy.yml` (see `commands/release-prod.md`).
- **Image tags built/pushed:** `${{ env.IMAGE }}:${{ github.sha }}` and `${{ env.IMAGE }}:latest`. Cloud Run deploys using the **SHA** tag.
- **Registry:** GCP Artifact Registry at `<REGION>-docker.pkg.dev/<PROJECT_ID>/agent-manager/agent-manager` (private).

**Release-related today:** `commands/release-prod.md` syncs public repo and triggers deploy; no versioned tags, no CHANGELOG, no public image.

---

## 3. Versioning Approach

**Use both: semver in `package.json` and git tags.**

- **`package.json` "version"** — Single source of truth. Bump when cutting a release (e.g. `2.0.1`, `2.1.0`).
- **Git tags (e.g. `v2.0.0`)** — Mark the exact commit that was released. Used for:
  - Triggering a release build (optional workflow on tag push).
  - GitHub Releases and release notes.
  - Reproducibility: "production is on `v2.0.0`".
- **Docker tags:**
  - **Every deploy (main):** Keep `IMAGE:${github.sha}` and `IMAGE:latest`.
  - **Milestone release:** Also tag the same image as `IMAGE:v2.0.0` and `IMAGE:2.0.0`. Version from `package.json` at build time or from `github.ref_name` when workflow runs on a tag.

---

## 4. What Counts as a Milestone

Pick one primary rule (or combine):

- **Feature / scope:** A defined set of work is done (e.g. "local Docker + npx plan done", "2FA first-login done"). Checklist in this plan or in `docs/release-criteria.md`.
- **Stability:** No known P0/P1 bugs for the release branch; tests and deploy pipeline green; optional soak on `latest`.
- **Calendar (optional):** e.g. every 4–6 weeks or after each quarter's goals.

**Practical default:** "Milestone = agreed scope is merged to `main`, checks pass, and we choose to publish a named release." Then tag that commit and run the release process.

---

## 5. Release Process (Minimal)

1. **Version**
   - Bump `package.json` version (e.g. `2.0.0` → `2.0.1` or `2.1.0`).
   - Commit (e.g. "Release 2.0.1" or "Bump version for 2.1.0").

2. **Changelog**
   - Maintain **`CHANGELOG.md`** in repo root.
   - Format: `## [2.0.1] - YYYY-MM-DD` plus bullet list of notable changes. Optionally link "Compare v2.0.0...v2.0.1".
   - Update before or in the release commit.

3. **Tag**
   - Create tag from that commit: `git tag v2.0.1` (match `package.json` with `v` prefix).
   - Push: `git push origin v2.0.1`.

4. **Build and tag image**
   - On **tag push** (e.g. `refs/tags/v*`): run build, then tag image with version: `IMAGE:v2.0.1`, `IMAGE:2.0.1`, and optionally update `IMAGE:latest`.
   - Get version from tag (`github.ref_name`) or from `package.json` in checkout.

5. **Publish to public registry (see §6)**
   - Push versioned tags to GHCR and/or Docker Hub so users can pull without GCP.

6. **GitHub Release**
   - Create a GitHub Release for the tag (e.g. `v2.0.1`).
   - Copy or summarize the `CHANGELOG.md` section into the release description; attach or link one-line run command, docker-compose snippet, and `.env.example`.

**Order:** Bump version → update CHANGELOG → commit → tag → push tag → (workflow builds and pushes versioned image to private + public) → create GitHub Release with notes.

---

## 6. Where to Publish the Docker Image

| Option | Pros | Cons |
|--------|------|------|
| **Docker Hub** | Familiar; no auth for public pulls; good discoverability. | Rate limits for anonymous pulls; org/namespace setup; separate from code repo. |
| **GHCR** | Tied to repo; `ghcr.io/org/repo:2.1.0`; free for public; code + image in one place. | Slightly less default for non-GitHub users; document `docker pull ghcr.io/...`. |
| **GCP Artifact Registry (existing)** | Already in use for Cloud Run; no new infra. | Private only; community would need GCP or a mirror. |
| **GCP Artifact Registry (public)** | Single registry for Cloud Run and public. | One-time setup; GCP-centric for users. |

**Recommendation:** Keep pushing to **existing private Artifact Registry** for Cloud Run. For community/milestones, add a **public** image: **GHCR** (or Docker Hub) so anyone can `docker pull` without GCP. Release workflow: build once, push versioned tags to both private (GCP) and public (GHCR/Docker Hub).

---

## 7. Artifacts Users Need

- **One-line run command** — e.g. `docker run -p 8080:8080 -e API_KEY=... -e ANTHROPIC_AUTH_TOKEN=... -v agent-manager-data:/persistent ghcr.io/org/agent-manager:2.1.0`
- **docker-compose snippet** — One service, image with version tag, volume at `/persistent`, `env_file: .env`, port 8080. Document "save as `docker-compose.yml` and run `docker compose up -d`."
- **`.env.example`** — Already in repo; ship in release notes so users can `cp .env.example .env` and set `API_KEY`, `ANTHROPIC_AUTH_TOKEN`.
- **Quick start** — Short README section or release note: create `.env`, set two vars, run the one-liner or `docker compose up`. Pin version tag for repeatability.
- **Optional:** Tarball (`docker save`) and checksums for air-gapped or offline users.

---

## 8. Implementation Phases

**Phase 1 – Version in build and tags**

1. Add version to Docker build: e.g. `ARG VERSION` / `LABEL` from `package.json` or tag; optional `/health` or `/api/health` version field.
2. Deploy workflow: keep building `IMAGE:${github.sha}` and `IMAGE:latest` on current trigger.
3. Add workflow (or extend deploy) that runs on **tag push** `v*`: build image, tag as `IMAGE:vX.Y.Z` and `IMAGE:X.Y.Z`, push to existing GCP Artifact Registry. No public registry yet.

**Phase 2 – Changelog and GitHub Release**

4. Add `CHANGELOG.md` with format above; document in CONTRIBUTING or release runbook that release commit updates it.
5. Release process: after pushing tag, manually or automatically create GitHub Release from tag; body from CHANGELOG section + one-line run + compose snippet + link to `.env.example`.

**Phase 3 – Public registry**

6. Choose GHCR (or Docker Hub). Add secrets (e.g. `GITHUB_TOKEN` for GHCR; `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` for Docker Hub).
7. In tag-triggered workflow: after building and pushing to GCP, also tag and push the same image to the public registry with version tags (and optionally `latest`).
8. Document in README: image location (e.g. `ghcr.io/org/agent-manager:2.1.0`), one-line `docker run`, docker-compose option, pin version for repeatability.

**Phase 4 – Optional**

9. Optional: tarball + checksums uploaded to GitHub Release assets.
10. Optional: `docs/release-criteria.md` checklist for "what makes a milestone".

---

## 9. Automation Summary

- **Release workflow:** On tag `v*`: build image → tag with version (and optionally `latest`) → push to GCP Artifact Registry → push same tags to public registry (GHCR/Docker Hub) → create/update GitHub Release with notes, one-liner, compose snippet, link to `.env.example`. Optionally add tarball + checksums.
- **Existing deploy workflow:** Unchanged for "deploy main to Cloud Run" (manual dispatch; SHA + latest to GCP only). Optionally add a job that only runs on tag and does the versioned push + GitHub Release.

---

## 10. References

- **Current deploy:** `.github/workflows/deploy.yml` — build with SHA + latest, Trivy, push to GCP, deploy Cloud Run.
- **Release procedure:** `commands/release-prod.md` — sync public repo, trigger deploy; to be extended or complemented by tag-based release workflow.
- **Local run:** `plans/local-docker-and-npx.md` — docker-compose and one-command run; release artifacts should align with that UX (image tag, env, volume).
- **Version today:** `package.json` `"version": "2.0.0"`; not used in image or API.

Sub-agent reports that informed this plan: current build/deploy and version usage; versioning strategy and milestone criteria; public distribution (registries, user artifacts, maintainer automation).
