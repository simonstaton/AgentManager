#!/bin/bash
set -eo pipefail

# ── 1. Inject API key suffix + merge MCP settings ────────────────────────────
# (Extracted from inline `node -e` for maintainability — see scripts/mcp-bootstrap.js)
node scripts/mcp-bootstrap.js

# ── 2. Configure GitHub CLI + git credentials if token is present ────────────
if [ -n "${GITHUB_TOKEN:-}" ]; then
  gh auth setup-git 2>/dev/null && echo "GitHub CLI configured for git operations" || true
fi

# ── 4. Sync from GCS (handled by server startup, but ensure dirs exist) ──────
mkdir -p /shared-context

# ── 5. Init persistent storage (volume or mountpoint) ─────────────────────────
# When /persistent is a mount (e.g. GCS FUSE or Docker volume), run full init.
# When /persistent exists but is not reported as mountpoint (e.g. some Docker
# named-volume setups), still create subdirs and set SHARED_CONTEXT_DIR so
# local Docker works reliably.
run_persistent_init() {
  mkdir -p /persistent/repos /persistent/tools /persistent/shared-context \
    /persistent/npm-cache /persistent/pnpm-store
  export SHARED_CONTEXT_DIR=/persistent/shared-context
  echo "Persistent storage active — UI will be at http://localhost:${PORT:-8080}; log in with API_KEY from .env"

  pnpm config set store-dir /persistent/pnpm-store --global 2>/dev/null \
    && echo "pnpm store configured at /persistent/pnpm-store" || true

  chown -R agent:agent /persistent/npm-cache 2>/dev/null || true
  npm config set cache /tmp/npm-cache --global 2>/dev/null || true \
    && echo "npm cache redirected to /tmp/npm-cache"

  # NOTE: /persistent/tools/ auto-shimming has been removed (Layer 7 security hardening).
  # Agents could write malicious scripts to /persistent/tools/ that would be auto-executed
  # as shims on the next container start, creating a persistence backdoor. If persistent
  # tools are needed in the future, add them manually with a verified integrity manifest.

  for bare_repo in /persistent/repos/*.git; do
    [ -d "$bare_repo" ] || continue
    git -C "$bare_repo" worktree prune 2>/dev/null && \
      echo "Pruned stale worktrees in $(basename "$bare_repo")" || true
  done
}

if [ -d /persistent ] && mountpoint -q /persistent 2>/dev/null; then
  run_persistent_init
elif [ -d /persistent ]; then
  # Docker named volume may not satisfy mountpoint -q; still init for local Docker.
  run_persistent_init
fi

# ── 7. Generate JWT_SECRET if not set ─────────────────────────────────────────
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "Generated ephemeral JWT_SECRET"
fi

# ── 8. Start server ──────────────────────────────────────────────────────────
exec node --import tsx server.ts
