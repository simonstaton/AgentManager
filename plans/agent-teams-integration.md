# Agent Teams Integration

## Current State

Platform agents run Claude CLI in `--print` mode with `stdio: ["ignore", "pipe", "pipe"]` ([src/agents.ts](src/agents.ts), lines 245-248, 840-856). This gives clean `stream-json` output but blocks Agent Teams, which requires interactive sessions where the lead can spawn teammates, manage a shared task list (`~/.claude/tasks/`), and communicate via a mailbox (`~/.claude/teams/`).

The gap is documented in [README.md](README.md) lines 86-88.

## Phase 0: Feasibility Spike (`--print` + env var)

**Goal**: Determine if setting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `--print` mode gives Claude access to the Agent Teams tools (spawn_teammate, send_message, etc.).

**Changes** (minimal, behind a flag):

- In `buildEnv()` ([src/agents.ts](src/agents.ts) line 956), conditionally set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- Add `agentTeams?: boolean` to `CreateAgentRequest` in [src/types.ts](src/types.ts) and pass it through
- Create a test agent with a prompt like "Create a team of 2 to research X" and observe whether Claude attempts to use team tools or says they're unavailable

**If it works**: The tools fire, teammates spawn as child `claude` processes, communicate via filesystem. This is the cheapest path — skip to Phase 2 for discovery/UI. The output parsing in `attachProcessHandlers` already handles any JSON event type via the `[key: string]: unknown` index signature on `StreamEvent`.

**If it doesn't work**: Proceed to Phase 1.

---

## Phase 1: Interactive Agent Mode

**Goal**: Run team lead agents in interactive mode (no `--print`) so Agent Teams tools work natively.

### 1a. New `buildClaudeArgs` path

In [src/agents.ts](src/agents.ts) `buildClaudeArgs` (line 840), branch on a `teamMode` flag:

```typescript
// Current (--print mode):
args.push("--print", "--", opts.prompt);

// New (interactive/team mode):
args.push("--teammate-mode", "in-process");
// Do NOT push --print
// Prompt sent via stdin after spawn
```

Also add `--output-format stream-json` to both paths (it's already there for `--print`; verify it works in interactive mode — if not, we'll need to parse raw output, see 1c).

### 1b. stdin piping

Change stdio from `["ignore", "pipe", "pipe"]` to `["pipe", "pipe", "pipe"]` for team mode agents.

**Initial prompt delivery**: After spawn, write the prompt to `proc.stdin` followed by a newline:

```typescript
proc.stdin.write(opts.prompt + "\n");
```

**Follow-up messages** (`message()` method, line 314): Instead of kill-and-respawn with `--resume`, write to the existing process's stdin. This is a fundamental change to the message lifecycle — the process stays alive between turns:

- Remove the `killAndWait` + re-spawn logic for team mode agents
- Write the new prompt to `proc.stdin` directly
- Detect "turn complete" / "waiting for input" state from stream events (look for a `system` event with `subtype: "idle"` or similar — needs verification)

### 1c. Output parsing fallback

If `--output-format stream-json` does NOT work without `--print`, interactive mode outputs ANSI-formatted terminal text. Options:

- **Option A (preferred)**: Use a pseudo-TTY (node-pty) to satisfy Claude's TTY detection, but still parse stdout. This may allow `--output-format stream-json` to work.
- **Option B**: Parse the interactive output. Strip ANSI codes, detect tool use blocks by pattern matching. Fragile — avoid if possible.
- **Option C**: Run a thin wrapper script that sets up a PTY and pipes structured output back to the platform.

### 1d. Environment changes

In `buildEnv()` ([src/agents.ts](src/agents.ts) line 956), for team mode agents:

```typescript
if (teamMode) {
  env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
}
```

### 1e. Lifecycle changes

Currently, agent status transitions are:

```
starting -> running -> idle (process exits with code 0)
                    -> error (process exits with non-zero)
```

In interactive mode, the process does NOT exit between turns. New status model:

```
starting -> running -> thinking (processing a turn)
                    -> waiting (turn complete, awaiting input)
                    -> idle (no activity for N seconds while waiting)
```

The `close` handler in `attachProcessHandlers` (line 673) needs a team-mode branch: process exit means the entire session ended (lead shut down), not just a turn completing.

---

## Phase 2: Teammate Discovery and UI

**Goal**: Monitor the filesystem to discover teammates spawned by the team lead, and surface them as read-only sub-entries in the UI.

### 2a. Teammate watcher service

New module `src/team-watcher.ts`:

- For each team-mode agent, poll `~/.claude/teams/` for team config files containing a `members` array
- Parse `~/.claude/tasks/{team-name}/` for the shared task list (task status, assignments, dependencies)
- Emit `StreamEvent`s to the team lead's event stream when teammates are created, tasks change status, or teammates send messages
- Poll interval: 2-3 seconds (filesystem watching with `fs.watch` as optimization)

Team config location: `~/.claude/teams/{team-name}/config.json` contains:

```json
{
  "members": [
    { "name": "security-reviewer", "agentId": "...", "agentType": "teammate" }
  ]
}
```

### 2b. Teammate data model

Add to [src/types.ts](src/types.ts):

```typescript
export interface Teammate {
  name: string;
  agentId: string;          // Claude's internal agent ID
  teamLeadId: string;       // Platform agent ID of the team lead
  teamName: string;
  status: "active" | "idle" | "stopped";
  currentTask?: string;
}
```

### 2c. API endpoints

In [src/routes/agents.ts](src/routes/agents.ts), add:

- `GET /api/agents/:id/teammates` — list discovered teammates for a team lead agent
- `GET /api/agents/:id/team-tasks` — list the shared task list for a team

### 2d. UI changes

In [ui/src/pages/AgentView.tsx](ui/src/pages/AgentView.tsx):

- Add a collapsible "Team" panel below the terminal when the agent is a team lead
- Show teammate names, status, and current task (read-only)
- Show the shared task list with status (pending / in-progress / completed) and assignments
- Poll the new API endpoints on a 3-5 second interval

In [ui/src/components/AgentCard.tsx](ui/src/components/AgentCard.tsx):

- Add a "Team Lead" badge when the agent has active teammates
- Show teammate count (e.g., "3 teammates")

### 2e. Cleanup reconciliation

When a team-mode agent is destroyed ([src/agents.ts](src/agents.ts) `doDestroy`, line 575):

- The `killProcessGroup` call (line 586) already kills the entire process group, which includes teammate processes (they're children of the lead)
- Additionally, clean up team state: remove `~/.claude/teams/{team-name}/` and `~/.claude/tasks/{team-name}/`
- The team watcher should detect the lead's death and stop polling

---

## Key Risks and Open Questions

- `--output-format stream-json` **without `--print`**: Unknown if this works. Phase 0 spike will answer this. If it doesn't, node-pty is the likely fallback.
- **stdin protocol**: How does interactive Claude expect input? Simple newline-delimited text, or something more complex? The spike will reveal this.
- **Teammate process ownership**: Teammates are child processes of the lead's `claude` process. Killing the lead's process group should cascade, but needs verification.
- **Session resumption**: The official docs say "No session resumption with in-process teammates." After a container restart, team state is lost. The platform should detect this and inform the user rather than trying to resume.
- **CLAUDE_HOME**: The `~/.claude/` directory where teams/tasks are stored. In the container, this is `/home/agent/.claude/` (or wherever `$HOME` points). Need to ensure it persists for the duration of the agent session and is writable.
- **Max agents guardrail**: Teammates spawned by Claude don't count toward the platform's `MAX_AGENTS` (10) limit, but they do consume resources. May need a separate `MAX_TEAMMATES_PER_LEAD` env var.
