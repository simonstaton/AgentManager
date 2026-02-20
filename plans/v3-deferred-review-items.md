# V3 Review — Deferred Items

Items identified in the 5-judge LLM review of commit `756bc0f` that were not addressed in the review-fixes PR. Each requires more design work or is a larger refactor.

---

## 1. `readPersistedEvents` streaming (Performance)

**Problem:** `readPersistedEvents()` in `src/agents.ts` reads the entire `.jsonl` file into memory with `readFile()`, splits all lines, then parses them. For agents with thousands of events, this causes a memory spike on every reconnect/subscribe call.

**Current code (~line 1216):**
```ts
const data = await readFile(filePath, "utf-8");
const lines = data.split("\n");
```

**Options:**
1. **Streaming readline** — Use `node:readline` with `createReadStream` to parse lines incrementally. Keeps memory bounded but is slower for small files and complicates the "skip to last N" logic.
2. **In-memory tail buffer** — Maintain a ring buffer of the last N events per agent in memory (populated on `handleEvent`). Serve reconnects from this buffer instead of re-reading disk. Falls back to disk read only for cold starts / restored agents.
3. **Hybrid** — Use the in-memory buffer for hot reconnects (covers 95% of cases), and streaming readline only for cold-start replay of restored agents.

**Recommendation:** Option 3 (hybrid). The in-memory buffer is ~trivial to add alongside `listenerBatch` and eliminates disk reads for the common case. Streaming readline is only needed for the restored-agent edge case.

**Affected files:** `src/agents.ts` (AgentProcess type, handleEvent, readPersistedEvents, subscribe, getEvents)

---

## 2. God class extraction (Architecture)

**Problem:** `AgentManager` in `src/agents.ts` is ~1600 lines and handles agent lifecycle, process management, event streaming, cost tracking, workspace setup, token refresh, watchdog monitoring, and file I/O. This makes it difficult to test individual concerns and increases cognitive load.

**Proposed extraction targets:**
- **`WorkspaceManager`** — `ensureWorkspace()`, `writeWorkspaceClaudeMd()`, `writeAgentTokenFile()`, `refreshAllAgentTokens()`, `saveAttachments()`, `buildEnv()`
- **`EventStore`** — `handleEvent()`, `flushEventBatch()`, `readPersistedEvents()`, `truncateEventFiles()`, write queue management
- **`ProcessManager`** — `attachProcessHandlers()`, `processLineBuffer()`, `killAndWait()`, `killProcessGroup()`, `buildClaudeArgs()`
- **`AgentWatchdog`** — `watchdogCheck()`, `cleanupExpired()`, stall detection logic

**Approach:** Extract one module at a time, starting with `WorkspaceManager` (most self-contained). Each extraction is a separate PR with its own test coverage. `AgentManager` delegates to the extracted classes and remains the public API.

**Risk:** The current class has tight coupling between concerns (e.g., `handleEvent` updates agent state, triggers cost tracking, and batches persistence). Extracting cleanly requires defining clear interfaces between modules.

**Affected files:** `src/agents.ts` (split into multiple files), test files

---

## 3. Virtuoso `initialTopMostItemIndex` magic number (Cosmetic)

**Problem:** In `ui/src/components/AgentTerminal.tsx` line 73:
```tsx
initialTopMostItemIndex={999999}
```
This relies on Virtuoso clamping out-of-range values to scroll to the bottom. It works but is fragile and unclear.

**Fix:** Replace with `blocks.length - 1` or use Virtuoso's `initialScrollToBottom` prop (if available in current version). Alternatively, use the `followOutput` callback which already handles this — the `initialTopMostItemIndex` may be redundant.

**Effort:** ~5 minutes. Low risk.

---

## 4. CostDashboard `confirm()` vs `ConfirmDialog` (Cosmetic)

**Problem:** The "Reset Cost History" button in the cost dashboard uses `window.confirm()` for its confirmation dialog. The rest of the app uses styled confirmation dialogs (or should). This is inconsistent with the design system.

**Fix:** Replace `window.confirm()` with the app's `ConfirmDialog` component (or create one if it doesn't exist). The dialog should match the destructive-action pattern used elsewhere in the UI.

**Affected files:** `ui/src/views/CostDashboard.tsx`

**Effort:** ~15 minutes. Need to check if a reusable `ConfirmDialog` already exists.

---

## 5. Pause/Resume loading states (UX Polish)

**Problem:** The pause and resume buttons in the agent UI don't show loading states while the API call is in flight. If the network is slow or the SIGSTOP/SIGCONT takes time, the user gets no feedback that their click was registered.

**Fix:**
1. Add `isPausing` / `isResuming` state to the agent control component
2. Show a spinner or disabled state on the button during the API call
3. Optimistically update the agent status in the local state, then reconcile with the server response
4. Handle error cases (e.g., process died while trying to pause) with a toast notification

**Affected files:** UI component that renders pause/resume buttons (likely in agent detail view or agent card)

**Effort:** ~30 minutes. Standard loading state pattern.
