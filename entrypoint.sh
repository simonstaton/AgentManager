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

# ── 5. Init persistent storage if GCS FUSE is mounted ───────────────────────
if [ -d /persistent ] && mountpoint -q /persistent 2>/dev/null; then
  mkdir -p /persistent/repos /persistent/tools /persistent/shared-context \
    /persistent/npm-cache /persistent/pnpm-store
  export SHARED_CONTEXT_DIR=/persistent/shared-context
  echo "Persistent storage (GCS FUSE) active"

  # Configure pnpm to use the persistent shared content-addressable store.
  # This means all agents share the same package store, so identical packages
  # are downloaded once and hard-linked into each project's node_modules.
  pnpm config set store-dir /persistent/pnpm-store --global 2>/dev/null \
    && echo "pnpm store configured at /persistent/pnpm-store" || true

  # Ensure npm cache dir is agent-owned (root may create it; agents need write
  # access). Also redirect npm cache to /tmp to avoid GCSFuse EMFILE/EPERM
  # errors that occur when npm tries to do concurrent renames on GCSFuse.
  chown -R agent:agent /persistent/npm-cache 2>/dev/null || true
  npm config set cache /tmp/npm-cache --global 2>/dev/null || true \
    && echo "npm cache redirected to /tmp/npm-cache"

  # NOTE: /persistent/tools/ auto-shimming has been removed (Layer 7 security hardening).
  # Agents could write malicious scripts to /persistent/tools/ that would be auto-executed
  # as shims on the next container start, creating a persistence backdoor. If persistent
  # tools are needed in the future, add them manually with a verified integrity manifest.

  # ── 6. Prune stale git worktrees from previous container runs ─────────────
  # When containers restart, /tmp workspace dirs are gone but worktree metadata
  # in /persistent/repos/*.git still references them. Clean up before server starts.
  for bare_repo in /persistent/repos/*.git; do
    [ -d "$bare_repo" ] || continue
    git -C "$bare_repo" worktree prune 2>/dev/null && \
      echo "Pruned stale worktrees in $(basename "$bare_repo")" || true
  done
fi

# ── 7. Generate JWT_SECRET if not set ─────────────────────────────────────────
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "Generated ephemeral JWT_SECRET"
fi

# ── 8. Start server ──────────────────────────────────────────────────────────
exec node --import tsx server.ts
