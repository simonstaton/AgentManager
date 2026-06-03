import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EpisodeKind = "task" | "result" | "decision" | "note";

export interface EpisodicEntry {
  id: string;
  agentId: string;
  ts: string; // ISO-8601
  kind: EpisodeKind;
  summary: string;
  detail?: string;
}

export interface AgentEpisodicLog {
  agentId: string;
  entries: EpisodicEntry[];
}

// ---------------------------------------------------------------------------
// Storage config (mirrors hook-config-store.ts pattern)
// ---------------------------------------------------------------------------

const PERSISTENT_BASE = "/persistent";
const PERSISTENT_AVAILABLE = existsSync(PERSISTENT_BASE);
const EPISODIC_DIR = PERSISTENT_AVAILABLE ? `${PERSISTENT_BASE}/episodic-logs` : "/tmp/episodic-logs";

mkdirSync(EPISODIC_DIR, { recursive: true });

export const MAX_ENTRIES = 500;

function logPath(agentId: string): string {
  return path.join(EPISODIC_DIR, `${agentId}.json`);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function getEpisodicLog(agentId: string): AgentEpisodicLog {
  const filePath = logPath(agentId);
  if (!existsSync(filePath)) {
    return { agentId, entries: [] };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as AgentEpisodicLog;
  } catch (err: unknown) {
    logger.warn(
      `[episodic-memory] Failed to read log for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { agentId, entries: [] };
  }
}

// ---------------------------------------------------------------------------
// Write (atomic: temp file + rename)
// ---------------------------------------------------------------------------

async function persistLog(agentId: string, log: AgentEpisodicLog): Promise<void> {
  const filePath = logPath(agentId);
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(log), "utf-8");
  await rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

export async function appendEpisode(
  agentId: string,
  entry: Pick<EpisodicEntry, "kind" | "summary" | "detail">,
): Promise<EpisodicEntry> {
  const full: EpisodicEntry = {
    id: randomUUID(),
    agentId,
    ts: new Date().toISOString(),
    kind: entry.kind,
    summary: entry.summary,
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
  };

  const log = getEpisodicLog(agentId);
  log.entries.push(full);

  // Trim oldest entries when over cap
  if (log.entries.length > MAX_ENTRIES) {
    log.entries = log.entries.slice(log.entries.length - MAX_ENTRIES);
  }

  await persistLog(agentId, log);
  return full;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function queryEpisodes(
  agentId: string,
  opts?: { kinds?: EpisodeKind[]; since?: string; limit?: number },
): EpisodicEntry[] {
  const log = getEpisodicLog(agentId);
  let results = log.entries;

  if (opts?.kinds && opts.kinds.length > 0) {
    const kindSet = new Set(opts.kinds);
    results = results.filter((e) => kindSet.has(e.kind));
  }

  if (opts?.since) {
    const sinceDate = new Date(opts.since).getTime();
    results = results.filter((e) => new Date(e.ts).getTime() >= sinceDate);
  }

  // Most-recent-first
  results = results.slice().reverse();

  if (opts?.limit !== undefined && opts.limit > 0) {
    results = results.slice(0, opts.limit);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Build resume context (pure helper)
// ---------------------------------------------------------------------------

export function buildResumeContext(agentId: string, opts?: { maxEntries?: number; maxChars?: number }): string {
  const maxEntries = opts?.maxEntries ?? 50;
  const maxChars = opts?.maxChars ?? 4000;

  const recent = queryEpisodes(agentId, { limit: maxEntries });
  if (recent.length === 0) return "";

  // Build from most recent → oldest, stop when char budget exhausted
  const lines: string[] = ["## Episodic Memory (most recent first)", ""];
  let chars = lines[0].length + 1; // include newline

  for (const entry of recent) {
    const line = `- **[${entry.kind}]** ${entry.ts.slice(0, 19).replace("T", " ")} — ${entry.summary}`;
    const lineChars = line.length + 1;
    if (chars + lineChars > maxChars) break;
    lines.push(line);
    chars += lineChars;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

export async function clearEpisodicLog(agentId: string): Promise<void> {
  const filePath = logPath(agentId);
  if (existsSync(filePath)) {
    const { unlink } = await import("node:fs/promises");
    await unlink(filePath);
  }
}
