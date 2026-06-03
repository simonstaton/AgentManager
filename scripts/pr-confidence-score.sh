#!/usr/bin/env bash
#
# pr-confidence-score.sh - Hallucination / Confidence Scoring for Agent PRs
#
# Analyzes a git diff and produces a confidence score from 0-100.
# The score is applied as a GitHub label on the PR so humans can
# triage low-confidence PRs for manual review.
#
# Usage:
#   ./scripts/pr-confidence-score.sh <pr-number> [base-branch]
#   ./scripts/pr-confidence-score.sh --dry-run [base-branch]
#
# Requires: git, gh (both pre-installed in the AgentManager container)
#
# Label scheme:
#   confidence: high   (80-100)  green
#   confidence: medium (50-79)   yellow
#   confidence: low    (20-49)   orange
#   confidence: critical (<20)   red

set -euo pipefail

# --- Argument parsing ---

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  PR_NUMBER="dry-run"
  BASE_BRANCH="${2:-main}"
else
  PR_NUMBER="${1:?Usage: pr-confidence-score.sh <pr-number|--dry-run> [base-branch]}"
  BASE_BRANCH="${2:-main}"
fi

# --- Input validation ---

if [ "$DRY_RUN" = false ]; then
  if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    echo "Error: PR_NUMBER must be a positive integer, got: $PR_NUMBER" >&2
    exit 1
  fi
fi

if [[ "$BASE_BRANCH" == -* ]]; then
  echo "Error: BASE_BRANCH cannot start with a dash, got: $BASE_BRANCH" >&2
  exit 1
fi

# --- Pre-flight checks ---

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: Not inside a git repository." >&2
  exit 1
fi

if [ "$DRY_RUN" = false ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "Error: gh CLI is not installed." >&2
    exit 1
  fi
fi

# --- Initialize all scoring variables ---
# Required: set -u crashes on unset vars if diff is empty.

CHANGED_LINES=0 FILES_CHANGED=0 TOTAL_LINES=0 ADDED_LINES=0 REMOVED_LINES=0
NEW_FILES=0 ADJUSTED_NEW_FILES=0 NEW_FILE_RATIO=0 IMPORT_LINES=0 NEW_DEPS=0
MAGIC_URLS=0 HARDCODED_KEYS=0 NEW_ROUTES=0 FETCH_CALLS=0
TEST_FILES=0 SRC_FILES_COUNT=0 NON_TEST_SRC=0 UNFINISHED=0 CONFIG_FILES=0
COMMENT_LINES=0 CODE_ADDITIONS=0
SIZE_PENALTY=0 NEW_FILE_PENALTY=0 IMPORT_PENALTY=0 MAGIC_PENALTY=0
API_PENALTY=0 TEST_PENALTY=0 UNFINISHED_PENALTY=0 CONFIG_PENALTY=0
DELETE_PENALTY=0 COMMENT_PENALTY=0 DUPLICATE_PENALTY=0 TOTAL_PENALTY=0
CRITICAL_FILES=0 DUPLICATE_LINES=0
TOTAL_BONUS=0 BONUS_TEST_RATIO=0 BONUS_SMALL_PR=0 BONUS_CLEAN_DIFF=0
DIFF_SOURCE="none"

# --- Gather the diff ---

DIFF_FILE=$(mktemp)
trap 'rm -f "$DIFF_FILE"' EXIT

# Exclude generated/lock files from analysis — same exclusion list as pr-size-check.
# Lock files (package-lock.json, yarn.lock) produce massive diffs with repetitive
# structure, hundreds of URLs, and no meaningful signal about code quality.
EXCLUDE_PATHS=(':(exclude)**/package-lock.json' ':(exclude)**/yarn.lock' ':(exclude)**/*.snap' ':(exclude)**/dist/' ':(exclude)**/*.generated.*')

if git diff "${BASE_BRANCH}...HEAD" -- "${EXCLUDE_PATHS[@]}" > "$DIFF_FILE" 2>/dev/null && [ -s "$DIFF_FILE" ]; then
  DIFF_SOURCE="${BASE_BRANCH}...HEAD"
elif git diff "origin/${BASE_BRANCH}...HEAD" -- "${EXCLUDE_PATHS[@]}" > "$DIFF_FILE" 2>/dev/null && [ -s "$DIFF_FILE" ]; then
  DIFF_SOURCE="origin/${BASE_BRANCH}...HEAD"
elif git diff HEAD~1 -- "${EXCLUDE_PATHS[@]}" > "$DIFF_FILE" 2>/dev/null && [ -s "$DIFF_FILE" ]; then
  DIFF_SOURCE="HEAD~1"
  echo "WARNING: Could not diff against ${BASE_BRANCH}. Falling back to HEAD~1 (last commit only)." >&2
fi

# Belt-and-suspenders: strip any excluded file sections that pathspec may have missed
# (git pathspec exclusions can behave differently across environments/git versions).
# Uses awk to drop entire diff sections for excluded filenames.
if [ -s "$DIFF_FILE" ]; then
  awk '
    /^diff --git / {
      skip = ($0 ~ /package-lock\.json|yarn\.lock|\.snap|\/dist\/|\.generated\./)
    }
    !skip { print }
  ' "$DIFF_FILE" > "${DIFF_FILE}.filtered" && mv "${DIFF_FILE}.filtered" "$DIFF_FILE"
fi

if [ ! -s "$DIFF_FILE" ]; then
  echo "WARNING: No diff found. Defaulting to score 50 (medium confidence)." >&2
  SCORE=50
else

# --- Dimension 1: Diff size & complexity ---

TOTAL_LINES=$(wc -l < "$DIFF_FILE")
ADDED_LINES=$(grep -cE '^\+([^+]|$)' "$DIFF_FILE" || true)
REMOVED_LINES=$(grep -cE '^\-([^-]|$)' "$DIFF_FILE" || true)
CHANGED_LINES=$((ADDED_LINES + REMOVED_LINES))
FILES_CHANGED=$(grep -c '^diff --git' "$DIFF_FILE" || true)

SIZE_PENALTY=0
if [ "$CHANGED_LINES" -gt 2000 ]; then
  SIZE_PENALTY=25
elif [ "$CHANGED_LINES" -gt 1000 ]; then
  SIZE_PENALTY=18
elif [ "$CHANGED_LINES" -gt 500 ]; then
  SIZE_PENALTY=12
elif [ "$CHANGED_LINES" -gt 200 ]; then
  SIZE_PENALTY=6
fi

if [ "$FILES_CHANGED" -gt 20 ]; then
  SIZE_PENALTY=$((SIZE_PENALTY + 10))
elif [ "$FILES_CHANGED" -gt 10 ]; then
  SIZE_PENALTY=$((SIZE_PENALTY + 5))
fi

# Apply 1.5x multiplier for changes touching critical files (auth, payment, migration)
CRITICAL_FILES=$(grep '^diff --git' "$DIFF_FILE" | grep -ciE '(auth|login|session|token|jwt|payment|billing|stripe|charge|migration|schema|\.env|secret|credential)' || true)
if [ "$CRITICAL_FILES" -gt 0 ]; then
  SIZE_PENALTY=$((SIZE_PENALTY * 3 / 2))
fi

# --- Dimension 2: New file ratio (excluding test files) ---

NEW_FILES=$(grep -c '^new file mode' "$DIFF_FILE" || true)

NEW_TEST_FILES=0
while IFS= read -r line; do
  if [[ "$line" =~ \.(test|spec)\.(ts|tsx|js|jsx) ]]; then
    NEW_TEST_FILES=$((NEW_TEST_FILES + 1))
  fi
done < <(grep -B5 '^new file mode' "$DIFF_FILE" | grep '^diff --git' || true)

ADJUSTED_NEW_FILES=$((NEW_FILES - NEW_TEST_FILES))
if [ "$ADJUSTED_NEW_FILES" -lt 0 ]; then ADJUSTED_NEW_FILES=0; fi

if [ "$FILES_CHANGED" -gt 0 ]; then
  NEW_FILE_RATIO=$((ADJUSTED_NEW_FILES * 100 / FILES_CHANGED))
else
  NEW_FILE_RATIO=0
fi

NEW_FILE_PENALTY=0
if [ "$NEW_FILE_RATIO" -gt 80 ]; then
  NEW_FILE_PENALTY=15
elif [ "$NEW_FILE_RATIO" -gt 50 ]; then
  NEW_FILE_PENALTY=8
elif [ "$NEW_FILE_RATIO" -gt 30 ]; then
  NEW_FILE_PENALTY=4
fi

# --- Dimension 3: Import / dependency changes ---

IMPORT_LINES=$(grep '^\+' "$DIFF_FILE" | grep -cE "(import .+ from ['\"]|require\(['\"])" || true)

# Restrict to package.json sections to avoid false positives from other JSON
PKG_DIFF_FILE=$(mktemp)
awk '/^diff --git.*package\.json/{found=1} found{print} /^diff --git/ && !/package\.json/{found=0}' "$DIFF_FILE" > "$PKG_DIFF_FILE"
NEW_DEPS=$(grep -cE '^\+\s+"[^"]+"\s*:\s*"[\^~]?[0-9]' "$PKG_DIFF_FILE" || true)
rm -f "$PKG_DIFF_FILE"

EXTRA_IMPORT=0
if [ "$IMPORT_LINES" -gt 20 ]; then EXTRA_IMPORT=3; fi
IMPORT_PENALTY=$((NEW_DEPS * 3 + EXTRA_IMPORT))
if [ "$IMPORT_PENALTY" -gt 15 ]; then IMPORT_PENALTY=15; fi

# --- Dimension 4: Magic strings & URLs ---

MAGIC_URLS=$(grep '^\+' "$DIFF_FILE" | grep -v '^\+\s*//' | grep -v '^\+\s*\*' | grep -v '^\+\s*#' | grep -cE 'https?://[^ ]+\.(com|io|org|net|dev)' || true)

# Scan only non-test source files for hardcoded secrets/tokens.
# Test files legitimately contain fake credentials (mock tokens, fixture PATs) —
# scanning them produces false positives that penalise well-tested security routes.
# URL scanning (above) uses the full diff since URLs in tests are usually real endpoints.
SRC_DIFF_FILE=$(mktemp)
trap 'rm -f "$DIFF_FILE" "$SRC_DIFF_FILE"' EXIT
awk '
  /^diff --git / {
    skip = ($0 ~ /\.(test|spec)\.(ts|tsx|js|jsx)|\/__tests__\/|\.spec\.|__fixtures__|vitest\.config/)
  }
  !skip { print }
' "$DIFF_FILE" > "$SRC_DIFF_FILE"

# Use shell variable for single-quote matching (POSIX ERE does not support \x27)
SQ="'"
HARDCODED_KEYS=$(grep '^\+' "$SRC_DIFF_FILE" | grep -ciE "(api[_-]?key|secret|token|password)\s*[:=]\s*[\"${SQ}][^\"${SQ}]{8,}" || true)

MAGIC_PENALTY=0
if [ "$HARDCODED_KEYS" -gt 0 ]; then
  MAGIC_PENALTY=$((MAGIC_PENALTY + 20))
fi
if [ "$MAGIC_URLS" -gt 10 ]; then
  MAGIC_PENALTY=$((MAGIC_PENALTY + 10))
elif [ "$MAGIC_URLS" -gt 3 ]; then
  MAGIC_PENALTY=$((MAGIC_PENALTY + 5))
fi

# --- Dimension 5: API endpoint references ---

NEW_ROUTES=$(grep '^\+' "$DIFF_FILE" | grep -cE '\.(get|post|put|patch|delete)\s*\(' || true)
FETCH_CALLS=$(grep '^\+' "$DIFF_FILE" | grep -cE "(fetch\(|axios\.|\.request\()" || true)

API_PENALTY=0
if [ "$NEW_ROUTES" -gt 10 ]; then
  API_PENALTY=8
elif [ "$NEW_ROUTES" -gt 5 ]; then
  API_PENALTY=4
fi
if [ "$FETCH_CALLS" -gt 5 ]; then
  API_PENALTY=$((API_PENALTY + 5))
fi

# --- Dimension 6: Test coverage signal ---

TEST_FILES=$(grep '^diff --git' "$DIFF_FILE" | grep -cE '\.(test|spec)\.(ts|tsx|js|jsx)' || true)
SRC_FILES_COUNT=$(grep '^diff --git' "$DIFF_FILE" | grep -cE '\.(ts|tsx|js|jsx)' || true)
NON_TEST_SRC=$((SRC_FILES_COUNT - TEST_FILES))

TEST_PENALTY=0
if [ "$NON_TEST_SRC" -gt 0 ] && [ "$TEST_FILES" -eq 0 ]; then
  TEST_PENALTY=10
elif [ "$NON_TEST_SRC" -gt 5 ] && [ "$TEST_FILES" -lt 2 ]; then
  TEST_PENALTY=5
fi

# --- Dimension 7: TODO/FIXME/HACK markers ---

UNFINISHED=$(grep '^\+' "$DIFF_FILE" | grep -ciE '(TODO|FIXME|HACK|XXX|WORKAROUND)' || true)

UNFINISHED_PENALTY=0
if [ "$UNFINISHED" -gt 5 ]; then
  UNFINISHED_PENALTY=10
elif [ "$UNFINISHED" -gt 2 ]; then
  UNFINISHED_PENALTY=5
elif [ "$UNFINISHED" -gt 0 ]; then
  UNFINISHED_PENALTY=2
fi

# --- Dimension 8: Config file changes ---

CONFIG_FILES=$(grep '^diff --git' "$DIFF_FILE" | grep -cE '(tsconfig\.json|package(-lock)?\.json|biome\.json|/\.env(\.[a-z]+)?[ \t]|Dockerfile|docker-compose\.(yml|yaml))' || true)

CONFIG_PENALTY=0
if [ "$CONFIG_FILES" -gt 3 ]; then
  CONFIG_PENALTY=10
elif [ "$CONFIG_FILES" -gt 1 ]; then
  CONFIG_PENALTY=5
fi

# --- Dimension 9: Deleted code ratio ---

DELETE_PENALTY=0
if [ "$CHANGED_LINES" -gt 0 ]; then
  DELETE_RATIO=$((REMOVED_LINES * 100 / CHANGED_LINES))
  if [ "$DELETE_RATIO" -gt 80 ]; then
    DELETE_PENALTY=10
  elif [ "$DELETE_RATIO" -gt 60 ]; then
    DELETE_PENALTY=5
  fi
fi

# --- Dimension 10: Comment-to-code ratio ---
# Only count JS/TS style comments (// and /*), not markdown or shell

COMMENT_LINES=$(grep '^\+' "$DIFF_FILE" | grep -cE '^\+\s*(//|/\*)' || true)
CODE_ADDITIONS=$((ADDED_LINES - COMMENT_LINES))

COMMENT_PENALTY=0
if [ "$ADDED_LINES" -gt 20 ]; then
  COMMENT_RATIO=$((COMMENT_LINES * 100 / ADDED_LINES))
  if [ "$COMMENT_RATIO" -gt 60 ]; then
    COMMENT_PENALTY=8
  elif [ "$COMMENT_RATIO" -gt 40 ]; then
    COMMENT_PENALTY=4
  fi
fi

# --- Dimension 11: Duplicate/repeated code detection ---
# Count distinct added lines that appear 3+ times (likely copy-paste)

DUPLICATE_LINES=$(grep '^+[^+]' "$DIFF_FILE" | sed 's/^\+//' | sort | uniq -c | awk '$1 >= 3 {print}' | wc -l || true)

DUPLICATE_PENALTY=0
if [ "$DUPLICATE_LINES" -ge 16 ]; then
  DUPLICATE_PENALTY=12
elif [ "$DUPLICATE_LINES" -ge 6 ]; then
  DUPLICATE_PENALTY=7
elif [ "$DUPLICATE_LINES" -ge 1 ]; then
  DUPLICATE_PENALTY=3
fi

# --- Calculate final score ---

TOTAL_PENALTY=$((SIZE_PENALTY + NEW_FILE_PENALTY + IMPORT_PENALTY + MAGIC_PENALTY + API_PENALTY + TEST_PENALTY + UNFINISHED_PENALTY + CONFIG_PENALTY + DELETE_PENALTY + COMMENT_PENALTY + DUPLICATE_PENALTY))

# --- Positive signals (bonuses, up to +15 total) ---

BONUS_TEST_RATIO=0
BONUS_SMALL_PR=0
BONUS_CLEAN_DIFF=0

# +5 if test files >= non-test source files (good coverage)
if [ "$SRC_FILES_COUNT" -gt 0 ] && [ "$TEST_FILES" -ge "$NON_TEST_SRC" ]; then
  BONUS_TEST_RATIO=5
fi

# +5 if small focused change (< 100 lines and < 5 files)
if [ "$CHANGED_LINES" -lt 100 ] && [ "$FILES_CHANGED" -lt 5 ]; then
  BONUS_SMALL_PR=5
fi

# +5 if no TODOs, no magic strings, no hardcoded credentials
if [ "$UNFINISHED" -eq 0 ] && [ "$MAGIC_URLS" -eq 0 ] && [ "$HARDCODED_KEYS" -eq 0 ]; then
  BONUS_CLEAN_DIFF=5
fi

TOTAL_BONUS=$((BONUS_TEST_RATIO + BONUS_SMALL_PR + BONUS_CLEAN_DIFF))

SCORE=$((100 - TOTAL_PENALTY + TOTAL_BONUS))
if [ "$SCORE" -gt 100 ]; then SCORE=100; fi
if [ "$SCORE" -lt 0 ]; then SCORE=0; fi

fi  # end of "if diff is empty" block


# --- Determine label ---

if [ "$SCORE" -ge 80 ]; then
  LABEL="confidence: high"
  COLOR="0e8a16"
  EMOJI="green"
elif [ "$SCORE" -ge 50 ]; then
  LABEL="confidence: medium"
  COLOR="fbca04"
  EMOJI="yellow"
elif [ "$SCORE" -ge 20 ]; then
  LABEL="confidence: low"
  COLOR="e99d42"
  EMOJI="orange"
else
  LABEL="confidence: critical"
  COLOR="d93f0b"
  EMOJI="red"
fi

# --- Build the breakdown report ---

CRITICAL_NOTE=""
if [ "$CRITICAL_FILES" -gt 0 ]; then
  CRITICAL_NOTE=" (${CRITICAL_FILES} critical file(s) detected, 1.5x multiplier applied)"
fi

REPORT="**Agent Confidence Score: ${SCORE}/100** -- ${LABEL}

<details>
<summary>Scoring breakdown (click to expand)</summary>

| Dimension | Penalty | Detail |
|-----------|---------|--------|
| Diff size & complexity | -${SIZE_PENALTY} | ${CHANGED_LINES} lines changed across ${FILES_CHANGED} files${CRITICAL_NOTE} |
| New file ratio | -${NEW_FILE_PENALTY} | ${ADJUSTED_NEW_FILES}/${FILES_CHANGED} non-test files are new (${NEW_FILE_RATIO}%) |
| Import/dependency changes | -${IMPORT_PENALTY} | ${NEW_DEPS} new dependencies, ${IMPORT_LINES} import lines |
| Magic strings & URLs | -${MAGIC_PENALTY} | ${MAGIC_URLS} URLs, ${HARDCODED_KEYS} possible secrets |
| API endpoint references | -${API_PENALTY} | ${NEW_ROUTES} route handlers, ${FETCH_CALLS} fetch calls |
| Test coverage signal | -${TEST_PENALTY} | ${TEST_FILES} test files for ${NON_TEST_SRC} source files |
| TODO/FIXME/HACK markers | -${UNFINISHED_PENALTY} | ${UNFINISHED} unfinished markers found |
| Config file changes | -${CONFIG_PENALTY} | ${CONFIG_FILES} config files modified |
| Deleted code ratio | -${DELETE_PENALTY} | ${REMOVED_LINES}/${CHANGED_LINES} lines removed |
| Comment-to-code ratio | -${COMMENT_PENALTY} | ${COMMENT_LINES}/${ADDED_LINES} added lines are comments |
| Duplicate/repeated code | -${DUPLICATE_PENALTY} | ${DUPLICATE_LINES} duplicate line patterns (3+ occurrences) |
| **Penalties total** | **-${TOTAL_PENALTY}** | |
| Test coverage bonus | +${BONUS_TEST_RATIO} | ${TEST_FILES} test file(s) for ${NON_TEST_SRC} source file(s) |
| Small focused PR bonus | +${BONUS_SMALL_PR} | ${CHANGED_LINES} changed lines across ${FILES_CHANGED} files |
| Clean diff bonus | +${BONUS_CLEAN_DIFF} | No TODOs, magic strings, or hardcoded keys |
| **Net Score** | **${SCORE}/100** | **${LABEL}** |

</details>

> Diff source: ${DIFF_SOURCE}. Scores below 50 should be manually reviewed by a human."

# --- Output ---

echo ""
echo "======================================================="
echo "  [$EMOJI]  Confidence Score: ${SCORE}/100  (${LABEL})"
echo "======================================================="
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "$REPORT"
  echo ""
  echo "(dry-run mode -- no labels or comments applied)"
  exit 0
fi

# --- Apply to PR ---

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
if [ -z "$REPO" ]; then
  REPO=$(git remote get-url origin 2>/dev/null | sed -n 's|.*github\.com[:/]\([^/]*/[^/.]*\)\(\.git\)\?$|\1|p' || true)
fi

if [ -z "$REPO" ]; then
  echo "WARNING: Could not determine repository. Skipping label/comment." >&2
else
  # Ensure the label exists
  gh api "repos/${REPO}/labels" -f name="$LABEL" -f color="$COLOR" \
    -f description="Agent confidence: ${LABEL#confidence: }" 2>/dev/null || true

  # Remove existing confidence labels (only ones actually present)
  CURRENT_LABELS=$(gh api "repos/${REPO}/issues/${PR_NUMBER}/labels" -q '.[].name' 2>/dev/null || true)
  for OLD_LABEL in "confidence: high" "confidence: medium" "confidence: low" "confidence: critical"; do
    if echo "$CURRENT_LABELS" | grep -qF "$OLD_LABEL"; then
      gh api "repos/${REPO}/issues/${PR_NUMBER}/labels/${OLD_LABEL// /%20}" -X DELETE 2>/dev/null || true
    fi
  done

  # Apply new label
  if gh pr edit "$PR_NUMBER" --add-label "$LABEL" 2>/dev/null; then
    echo "Label '${LABEL}' applied to PR #${PR_NUMBER}"
  elif gh api "repos/${REPO}/issues/${PR_NUMBER}/labels" -f "labels[]=$LABEL" >/dev/null 2>&1; then
    echo "Label '${LABEL}' applied to PR #${PR_NUMBER} (via REST API)"
  else
    echo "WARNING: Failed to apply label to PR #${PR_NUMBER}" >&2
  fi

  # Update or create the confidence-score comment (avoids comment spam)
  MARKER="<!-- confidence-score -->"
  FULL_REPORT="${MARKER}
${REPORT}"

  EXISTING_COMMENT_ID=$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" \
    --paginate -q '.[] | select(.body | startswith("<!-- confidence-score -->")) | .id' 2>/dev/null | tail -1 || true)

  if [ -n "$EXISTING_COMMENT_ID" ]; then
    if gh api "repos/${REPO}/issues/comments/${EXISTING_COMMENT_ID}" -X PATCH -f body="$FULL_REPORT" >/dev/null 2>&1; then
      echo "Confidence score comment updated on PR #${PR_NUMBER}"
    else
      echo "WARNING: Failed to update comment on PR #${PR_NUMBER}" >&2
    fi
  else
    if gh pr comment "$PR_NUMBER" --body "$FULL_REPORT" >/dev/null 2>&1; then
      echo "Confidence score comment posted to PR #${PR_NUMBER}"
    elif gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" -f body="$FULL_REPORT" >/dev/null 2>&1; then
      echo "Confidence score comment posted to PR #${PR_NUMBER} (via REST API)"
    else
      echo "WARNING: Failed to post comment to PR #${PR_NUMBER}" >&2
    fi
  fi
fi

# Exit with non-zero if low or critical confidence (score < 50).
# This CI check catches egregiously bad PRs. Medium-confidence PRs (50-79) pass
# CI so humans can review them on GitHub, but the merge-gate API still blocks
# agent auto-merges for anything below "confidence: high" (score >= 80).
# Two-layer enforcement: CI blocks low/critical, merge-gate API blocks medium too.
if [ "$SCORE" -lt 50 ]; then
  echo ""
  if [ "$SCORE" -lt 20 ]; then
    echo "CRITICAL confidence -- this PR MUST NOT be merged without human review."
  else
    echo "LOW confidence -- this PR should NOT be merged without human review."
  fi
  exit 1
fi
