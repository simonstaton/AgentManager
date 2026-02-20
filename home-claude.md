# Global Agent Instructions

## MCP & Integrations (REQUIRED)

**Figma and Linear are configured as MCP servers with token auth - use MCP tools directly.**
They should appear as available tools in your session (e.g. Figma tools like `mcp__figma__...`). Just use them. The auth headers are pre-configured.

If MCP tools are NOT available in your session (check with `/mcp`), fall back to the API slash commands:
- **Linear fallback**: `/linear` - direct GraphQL API examples
- **Figma fallback**: `/figma` - direct REST API examples

Do NOT attempt OAuth flows. Token auth is already configured.

## Pull Request CI Checks (REQUIRED)

When you create a PR, you MUST monitor CI checks and fix any failures. Do NOT just poll status and report "still running" — actively watch for failures and fix them.

### Before Creating a PR
Always run the project's quality checks locally first:
```bash
npm run check   # Runs: lint + typecheck + tests
```
Fix all issues before pushing and creating the PR. This prevents most CI failures.

### After Creating a PR
1. **Watch for check completion** — use `--watch` so you block until checks finish:
   ```bash
   gh pr checks --watch --fail-fast
   ```
2. **If checks pass** — you're done. Report success and move on.
3. **If checks fail** — you MUST fix them. Do NOT just report the failure and stop.

### Fixing CI Failures
When `gh pr checks` reports a failure:
1. **Get the failure details** — find the failed run and read its logs:
   ```bash
   # List the failed checks to get the job/run info
   gh pr checks

   # View the failed run's logs (use the run ID from the checks output)
   gh run view <run-id> --log-failed
   ```
2. **Parse the error output** — identify the specific lint errors, type errors, or test failures.
3. **Fix the code** — make the necessary changes in your worktree.
4. **Commit and push** — this triggers a new CI run:
   ```bash
   git add <fixed-files>
   git commit -m "fix: resolve CI failures"
   git push
   ```
5. **Watch the new run** — repeat from step 1 until checks pass:
   ```bash
   gh pr checks --watch --fail-fast
   ```

### Anti-patterns — Do NOT Do These
- **Do NOT** keep polling `gh pr checks` in a loop just to report "still pending" — use `--watch` instead.
- **Do NOT** report a CI failure without reading the actual error output and attempting a fix.
- **Do NOT** create a new PR to work around a failing check — fix the issue on the same branch.
- **Do NOT** give up after one failed attempt — iterate until checks pass or you've identified a genuine blocker that requires human input.
