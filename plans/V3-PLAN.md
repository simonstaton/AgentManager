# SWARM V3 Upgrade Plan
**Stability | Performance | Intelligence | Coordination**
*February 2026*

---

## Executive Summary

Swarm V3 is a comprehensive upgrade addressing four interconnected problem areas: runtime stability and performance, agent lifecycle improvements, coordination intelligence, and developer experience. The plan is structured into five sequential phases, each building on the last, with a total estimated scope of 8 to 12 weeks depending on team size.

| | |
|---|---|
| **Current State** | In-memory pub/sub, shared markdown files, sequential prompts, UI tightly coupled to agent processes |
| **Target State** | Process-isolated agents, structured world model, orchestrator planner, virtualised UI, persistent state |
| **Primary Risk** | Performance and crash issues are blocking usability today — address Phase 1 before anything else |

---

## Phase 1: Stability and Performance
> Fix what is breaking today before adding anything new

### 1.1 AgentTerminal Output Virtualisation

The terminal output accumulating unbounded in the DOM is the most likely cause of crashes when 15+ agents run. This needs to be addressed before any other UI work.

- Implement windowed / virtual rendering for terminal output (e.g. `react-window` or a custom fixed-height scroll container that only renders visible lines)
- Cap in-memory line buffer per agent at a configurable limit (suggested: 2,000 lines); older lines are trimmed and optionally flushed to disk
- Add a **Download Log** button per agent so output is never truly lost
- Lazy-mount `AgentTerminal` components: do not render a terminal at all until its tab is first visited

### 1.2 Agent Process Isolation

Running 15 agents inside a single Node process creates memory pressure and means one crash takes everything down. Move each agent into its own child process or worker.

- Spawn each agent as a `child_process` or `worker_thread`; communicate via IPC or a lightweight message bus
- The parent process becomes a thin coordinator: it routes messages and monitors health but does no heavy work itself
- If scaling beyond a single machine is required, containerise agents and use Terraform to provision per-agent services (ECS tasks or Lambda) behind a lightweight API gateway
- This also enables the pause/resume model (Phase 2) since processes can be suspended via `SIGSTOP` / `SIGCONT` or IPC

### 1.3 npm Install Caching / Fast Starts

Agents should not reinstall dependencies on every run. This is a straightforward caching problem.

- Create a shared, persistent `node_modules` volume or cache directory that agents mount read-only at start
- Use a Task Leader (TL) agent or setup hook that runs `npm install` once and signals readiness; worker agents wait on that signal before starting
- Move linting, formatting, and pre-flight checks to the TL / setup phase so worker agents start clean
- Consider using `pnpm` with a shared content-addressable store as a drop-in replacement for faster installs

### 1.4 Agent Status Detection

Agents getting stuck on "Running" after completion suggests missing lifecycle signalling. Add explicit terminal state transitions.

- Define a clear state machine: `Queued > Starting > Running > Paused > Completed | Failed | Cancelled`
- Agents emit a `done` event (with exit code and summary) when their Claude CLI process exits
- A watchdog timer on the coordinator: if no output is received from an agent for N seconds, mark it as **Stalled** and surface a prompt to the user
- Fix the billing page and total costs display as part of this phase since both depend on reliable agent lifecycle events

### 1.5 Persistent Cost Tracking

Cost data should survive server restarts.

- Write a running cost total to disk (SQLite or a simple JSON file) on every cost event
- On server start, read the persisted value to initialise the in-memory counter
- Add a **Reset Session Costs** button on the billing page that zeroes the persistent store
- Show both all-time spend and current-session spend as separate figures

---

## Phase 2: Agent Control and UX Polish
> Give users meaningful control over agent execution

### 2.1 Pause and Resume

A pause button next to Send, similar to the Cursor IDE pattern, lets users intervene without killing an agent.

- **UI:** add Pause button alongside Send; toggles to Resume when agent is paused
- **Backend:** send a pause signal to the agent child process (`SIGSTOP` or an IPC message depending on implementation)
- Agent acknowledges the pause by emitting a `paused` event; UI reflects this in the status indicator
- On Resume, the agent continues from its current position in the conversation

### 2.2 Agent Metadata Panel

Users need visibility into what each agent is doing and where it is operating.

- Add a metadata sidebar or tooltip per agent showing: current repo, active branch, worktree path, working directory, process ID, uptime, token usage, and cost so far
- All clickable elements across the application must use `cursor: pointer` (a global CSS pass)
- Replace the settings dialog with individual settings pages; each setting category gets its own route

### 2.3 Confidence Grading for Agent Fixes

Before an agent proposes a merge or code change, it should self-assess risk.

- After producing a fix, the agent runs a secondary grading prompt asking it to rate: ticket clarity (high/medium/low), fix confidence (high/medium/low), and blast radius (isolated/moderate/broad)
- The combined score produces a risk label:
  - **Low Risk** — safe to auto-merge
  - **Medium Risk** — human review recommended
  - **High Risk** — block merge, escalate to orchestrator
- Surface the risk label prominently in the PR description and in the Swarm UI
- High-risk changes trigger a notification and require explicit user approval before the agent proceeds

### 2.4 UI / UX Cleanup

- Remove em-dashes from all page titles and UI copy; replace with plain dashes or restructure the sentence
- Audit all AI-generated copy for other tell-tale patterns and rewrite in plain product language
- Ensure `cursor: pointer` on every button, link, tab, and interactive card across the app
- Delete the settings dialog; replace with routed settings pages

---

## Phase 3: Coordination Intelligence
> From parallel prompts to a real multi-agent system

### 3.1 Structured World Model

Replace shared markdown files with a queryable, versioned task graph. The bulletin board approach breaks down at scale.

- Implement a Task Graph store (SQLite or in-memory with persistence): each task has an ID, title, status, owner agent, dependencies, inputs, expected outputs, and acceptance criteria
- Agents query the world model via an internal API: *"give me an unblocked, unowned task I am capable of handling"*
- Task state transitions are atomic and versioned; conflicts are resolved by the orchestrator
- The shared markdown files become a human-readable view generated from the task graph, not the source of truth

### 3.2 Dedicated Orchestrator Agent with Plan-Execute-Observe Loop

Coordination should not depend on how you prompt a worker agent. It needs a dedicated role with an explicit planning loop.

- The orchestrator receives a top-level goal and decomposes it into a DAG of tasks using a structured planning prompt
- It assigns tasks to worker agents based on declared capabilities, current load, and historical success rates
- After each assignment, it observes: did the agent complete the task, return an output matching the expected schema, and pass the acceptance test?
- On failure, the orchestrator replans: retry with same agent, reassign to a different agent, or escalate to the user
- The orchestrator itself runs in a persistent process with its own loop, not as a one-shot prompt

### 3.3 Capability-Aware Routing

The agent registry exists but is unused in routing decisions. Fix that.

- Extend agent capability declarations to include: capability tags, confidence levels per tag, and historical success rate (maintained by the orchestrator)
- When assigning a task, the orchestrator scores available agents against the task requirements and picks the best fit
- If an agent repeatedly fails a capability category, it is deprioritised for that type of task until a human re-enables it

### 3.4 Structured Inter-Agent Contracts

Task messages are currently free-form strings. Define typed schemas so agents can validate handoffs.

- Define a `TaskMessage` schema: `task_id`, `type`, `input` (typed), `expected_output` (typed), `success_criteria`, `timeout_ms`
- Agents validate the input against the schema before starting; reject malformed tasks immediately
- On completion, agents return a `TaskResult`: `task_id`, `status`, `output` (typed), `confidence`, `duration_ms`
- The orchestrator validates the result before marking the dependency chain as unblocked

### 3.5 Failure Propagation and Recovery

Currently if agent B fails, agent A simply stalls. This must be automatic.

- When a task fails, the orchestrator immediately notifies all agents waiting on that task
- Dependent agents enter a **Blocked** state with a reason; they do not continue attempting work
- The orchestrator attempts recovery: retry, alternative agent, or decompose the failed task into smaller subtasks
- If recovery fails after N attempts, the failure is escalated to the user with a clear summary of what was tried

---

## Phase 4: Observability and Memory
> Make the system debuggable and self-improving

### 4.1 Structured Trace and Plan Graph

Beyond terminal output, every orchestrator decision should be captured in a structured trace.

- Log every orchestrator action: task created, assigned to agent X because Y, completed in Z ms, output validated / rejected
- Expose a **Plan Graph** view in the UI showing the DAG of tasks: status (pending / running / done / failed), assigned agent, duration, and cost per step
- Show working memory state at each decision point: what did the orchestrator know when it made this call?

### 4.2 Agent Memory Architecture

The current memory model is just chat history. Layer in structured memory types.

- **Short-term working memory:** the current plan, active constraints, and in-progress tasks; stored in the agent process, reset on restart
- **Long-term project knowledge:** persistent facts about the codebase, conventions, and past decisions; stored in a vector store or structured JSON keyed by project
- **Episodic logs:** what was tried, what worked, what failed; written to disk and retrievable by the orchestrator for replanning
- **Artifact memory:** files, patches, and tests produced by agents are linked to the tasks that produced them; the orchestrator can reference them in future assignments

### 4.3 Scheduler and Wake-on-Alert

Agents need a way to operate on a schedule and to be woken when the server restarts.

- Implement a cron scheduler (`node-cron` or equivalent) that persists scheduled tasks to disk
- On server start, the scheduler reads persisted jobs and re-queues any that were missed while the server was down
- An alerting agent can be scheduled to check system health, notify external channels (Slack, email, webhook), and optionally wake sleeping agents via the orchestrator

---

## Phase 5: Repo Health and Outreach Readiness
> Make the project contribution-ready and publicly compelling

### 5.1 GitHub and CI Hardening

- Remove the SARIF upload step from CI entirely; it is noise without GitHub Code Scanning enabled
- Upgrade to GitHub Pro or make the repo public to enable CODEOWNERS and enforce PR checks properly
- Add a `CODEOWNERS` file defining reviewers for each major area once the above is resolved
- Ensure all GitHub Actions jobs pass cleanly; remove or gate any steps that fail silently

### 5.2 Security: 2FA on First Login

- On first successful login, detect that 2FA is not yet configured and redirect to a setup wizard
- Support TOTP (Google Authenticator / Authy) as the primary second factor
- Store 2FA status against the user account; subsequent logins check this flag before granting access

### 5.3 Repo Cleanup

- Delete the kill switch plan document and any other files marked as obsolete
- Audit the codebase for `TODO`, `FIXME`, and placeholder comments; resolve or create tracked issues for each
- Ensure the README accurately reflects the current architecture and setup steps

### 5.4 Promotion and Outreach

- Write a compelling project README: what problem does Swarm solve, who is it for, what makes it different
- Add a short demo GIF or video link showing agents collaborating on a real task
- Create a `CONTRIBUTING.md` with clear contribution guidelines, architecture overview, and local setup instructions
- Prepare a launch post (Hacker News Show HN, X, LinkedIn) with a concrete example of Swarm solving a real ticket end to end
- Tag the V3 release clearly on GitHub with a changelog

---

## Priority and Sequencing

| Phase | Priority | Estimated Effort | Key Outcome |
|---|---|---|---|
| 1 - Stability | **Critical** | 2-3 weeks | App no longer crashes, agents start fast, costs persist |
| 2 - Control and UX | **High** | 1-2 weeks | Pause/resume, risk grading, metadata visibility |
| 3 - Coordination | **High** | 3-4 weeks | Real orchestrator, typed contracts, failure recovery |
| 4 - Observability | **Medium** | 1-2 weeks | Plan graph, structured memory, scheduler |
| 5 - Repo and Outreach | **Medium** | 1 week | CI clean, 2FA, docs, launch-ready |

> Phases 3 and 4 can run in parallel once Phase 2 is stable. Do not skip Phase 1.

---

*Swarm V3 Upgrade Plan | Confidential | February 2026*