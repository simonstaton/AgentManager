# Phase 4.2: Agent Memory Architecture

**Status:** Planned
**Priority:** Medium
**Estimated effort:** 3-5 days
**Depends on:** Phase 3 (task graph, orchestrator) - already implemented

---

## Problem

Agents currently have no structured memory beyond chat history and shared markdown files. When an agent restarts, it loses all context about what it learned, what it tried, and what worked. The orchestrator cannot reference past outcomes when making future assignments. This limits the system's ability to improve over time and forces agents to rediscover context repeatedly.

---

## Architecture Overview

Four memory layers, each with a different scope and lifetime:

| Layer | Scope | Storage | Lifetime | Access |
|---|---|---|---|---|
| Working Memory | Per-agent, per-session | In-memory Map | Agent process lifetime | Agent only |
| Long-Term Knowledge | Per-project | SQLite | Persistent across restarts | All agents (read), orchestrator (read/write) |
| Episodic Logs | Per-task execution | SQLite | Persistent, prunable | Orchestrator (read/write), agents (read) |
| Artifact Memory | Per-task output | SQLite + filesystem | Persistent, prunable | All agents (read), producing agent (write) |

---

## Detailed Design

### 1. Working Memory

In-memory state held by each agent process. Tracks the agent's current plan, active constraints, and task context. Cheap to read/write, lost on restart by design.

**Data model:**
```typescript
interface WorkingMemory {
  agentId: string;
  currentPlan: string | null;
  activeConstraints: string[];
  taskContext: Record<string, unknown>;
  scratchpad: string[];       // freeform notes the agent writes to itself
  updatedAt: number;
}
```

**Implementation:**
- Simple `Map<string, WorkingMemory>` in the agent process
- Exposed via agent-local methods, not an API endpoint (no cross-agent access)
- Optionally snapshot to disk on graceful shutdown for warm restarts

### 2. Long-Term Knowledge

Persistent facts about the codebase, conventions, and decisions. Shared across all agents working on the same project. This replaces the role that shared-context markdown files play today, with structured queryability.

**Schema (SQLite):**
```sql
CREATE TABLE knowledge (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  project     TEXT NOT NULL,
  category    TEXT NOT NULL,        -- 'convention', 'architecture', 'decision', 'fact'
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  source      TEXT,                 -- agent ID or 'user' or 'orchestrator'
  confidence  REAL DEFAULT 1.0,    -- 0.0 to 1.0
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(project, category, key)
);

CREATE INDEX idx_knowledge_project ON knowledge(project);
CREATE INDEX idx_knowledge_category ON knowledge(project, category);
```

**Examples:**
- `(project: "swarm", category: "convention", key: "imports", value: "Use node: prefix for builtins")`
- `(project: "swarm", category: "decision", key: "orm", value: "No ORM - raw better-sqlite3 with prepared statements")`
- `(project: "swarm", category: "architecture", key: "auth-flow", value: "Single API_KEY exchanged for JWT via POST /api/auth/token")`

**API endpoints:**
```
GET    /api/memory/knowledge?project=X&category=Y    -- query entries
POST   /api/memory/knowledge                          -- upsert an entry
DELETE /api/memory/knowledge/:id                       -- remove an entry
```

### 3. Episodic Logs

Structured records of what was tried and what happened. The orchestrator references these when replanning or assigning tasks to avoid repeating failed approaches.

**Schema (SQLite):**
```sql
CREATE TABLE episodes (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  task_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  action      TEXT NOT NULL,         -- 'attempted', 'completed', 'failed', 'retried'
  approach    TEXT NOT NULL,         -- description of what was tried
  outcome     TEXT,                  -- description of what happened
  duration_ms INTEGER,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX idx_episodes_task ON episodes(task_id);
CREATE INDEX idx_episodes_agent ON episodes(agent_id);
CREATE INDEX idx_episodes_action ON episodes(action);
```

**Usage patterns:**
- Orchestrator queries: "What approaches were tried for task X?" before reassigning
- Agent queries: "What worked for similar tasks in the past?" to inform strategy
- Analytics: success rates by approach, agent performance over time

**API endpoints:**
```
GET    /api/memory/episodes?task_id=X                 -- episodes for a task
GET    /api/memory/episodes?agent_id=X&action=failed  -- failures by agent
POST   /api/memory/episodes                            -- log an episode
```

### 4. Artifact Memory

Links files, patches, and tests produced by agents to the tasks that produced them. Enables the orchestrator to reference outputs in future assignments without re-reading file trees.

**Schema (SQLite):**
```sql
CREATE TABLE artifacts (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  task_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  type        TEXT NOT NULL,         -- 'file', 'patch', 'test', 'document', 'config'
  path        TEXT NOT NULL,         -- relative path within workspace
  description TEXT,
  size_bytes  INTEGER,
  checksum    TEXT,                  -- SHA-256 of content at creation time
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX idx_artifacts_task ON artifacts(task_id);
CREATE INDEX idx_artifacts_type ON artifacts(type);
CREATE INDEX idx_artifacts_path ON artifacts(path);
```

**API endpoints:**
```
GET    /api/memory/artifacts?task_id=X          -- artifacts for a task
GET    /api/memory/artifacts?type=test          -- all test artifacts
POST   /api/memory/artifacts                     -- register an artifact
DELETE /api/memory/artifacts/:id                  -- deregister
```

---

## File Structure

```
src/
  memory/
    index.ts              -- MemoryStore class, initialises all layers
    working-memory.ts     -- WorkingMemory in-memory store
    knowledge-store.ts    -- Long-term knowledge (SQLite)
    episode-store.ts      -- Episodic logs (SQLite)
    artifact-store.ts     -- Artifact registry (SQLite)
    memory.test.ts        -- Unit tests for all stores
  routes/
    memory.ts             -- Express routes for /api/memory/*
```

**Database location:** `/persistent/memory.db` (single SQLite file, WAL mode, same pattern as cost-tracker and task-graph)

---

## Integration Points

1. **Orchestrator** (`src/orchestrator.ts`):
   - Reads episodic logs before replanning
   - Writes knowledge entries when discovering project conventions
   - References artifact registry when composing task inputs

2. **Agent processes** (`src/agents.ts`):
   - Each agent gets a `WorkingMemory` instance on spawn
   - Agents write episodic logs on task completion/failure
   - Agents register artifacts when producing files

3. **Task graph** (`src/task-graph.ts`):
   - Task completion triggers episodic log entry
   - Artifact registration linked to task IDs

4. **UI** (`ui/src/views/`):
   - New "Memory" tab or section showing knowledge base entries
   - Episode timeline per task in the task detail view
   - Artifact list per task

---

## Implementation Sequence

1. **Database setup**: Create `src/memory/index.ts` with SQLite initialisation and migrations
2. **Knowledge store**: Implement CRUD for long-term knowledge with API routes
3. **Episode store**: Implement logging and query for episodic records with API routes
4. **Artifact store**: Implement artifact registration with API routes
5. **Working memory**: Add in-memory store to agent spawn lifecycle
6. **Orchestrator integration**: Wire episode and knowledge queries into the plan-execute-observe loop
7. **UI views**: Add memory/knowledge panel to the UI
8. **Tests**: Unit tests for each store, integration test for orchestrator memory queries

---

## Open Questions

- **Retention policy**: How long should episodic logs be kept? Suggest 30-day default with configurable pruning.
- **Knowledge conflicts**: When two agents write conflicting knowledge entries, who wins? Suggest orchestrator arbitration with higher confidence score.
- **Shared-context migration**: Should existing shared-context markdown files be migrated into the knowledge store, or kept as a parallel system? Suggest keeping both initially, with knowledge store as the structured layer and markdown as human-readable notes.

---

*Phase 4.2 - Agent Memory Architecture | AgentManager V3*
