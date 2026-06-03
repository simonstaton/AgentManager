"use client";

import { memo } from "react";
import type { StreamEvent } from "../../api";
import type { AgentLogEntry } from "../../hooks/useAllAgentLogs";

// ─── Agent color palette ─────────────────────────────────────────────────────

const AGENT_COLORS = [
  { text: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20" },
  { text: "text-sky-400", bg: "bg-sky-400/10", border: "border-sky-400/20" },
  { text: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/20" },
  { text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
  { text: "text-rose-400", bg: "bg-rose-400/10", border: "border-rose-400/20" },
  { text: "text-cyan-400", bg: "bg-cyan-400/10", border: "border-cyan-400/20" },
  { text: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/20" },
  { text: "text-pink-400", bg: "bg-pink-400/10", border: "border-pink-400/20" },
  { text: "text-lime-400", bg: "bg-lime-400/10", border: "border-lime-400/20" },
  { text: "text-teal-400", bg: "bg-teal-400/10", border: "border-teal-400/20" },
] as const;

function agentColorIndex(agentId: string): number {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) {
    h = (h * 31 + agentId.charCodeAt(i)) & 0xffff;
  }
  return h % AGENT_COLORS.length;
}

export function agentColor(agentId: string) {
  return AGENT_COLORS[agentColorIndex(agentId)];
}

// ─── Event parsing ────────────────────────────────────────────────────────────

export type EntryKind = "output" | "error" | "system" | "tool" | "result" | "user";

export interface ParsedEntry {
  kind: EntryKind;
  text: string;
  toolName?: string;
}

export interface FlatEntry extends AgentLogEntry {
  parsed: ParsedEntry;
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash":
      return String(input.command ?? "").slice(0, 100);
    case "Read":
      return String(input.file_path ?? "");
    case "Write":
      return String(input.file_path ?? "");
    case "Edit":
      return String(input.file_path ?? "");
    case "Glob":
      return String(input.pattern ?? "");
    case "Grep":
      return String(input.pattern ?? "");
    case "WebFetch":
      return String(input.url ?? "").slice(0, 80);
    case "WebSearch":
      return String(input.query ?? "");
    case "Task":
      return String(input.description ?? "").slice(0, 80);
    case "TodoWrite": {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      if (todos.length === 0) return "";
      const done = todos.filter((t: Record<string, unknown>) => t.status === "completed").length;
      const active = todos.filter((t: Record<string, unknown>) => t.status === "in_progress").length;
      const parts: string[] = [`${done}/${todos.length} done`];
      if (active > 0) parts.push(`${active} active`);
      return parts.join(", ");
    }
    default: {
      const keys = Object.keys(input);
      if (!keys.length) return "";
      const v = input[keys[0]];
      return typeof v === "string" ? v.slice(0, 80) : keys.join(", ");
    }
  }
}

function parseEntry(event: StreamEvent): ParsedEntry | ParsedEntry[] | null {
  switch (event.type) {
    case "assistant": {
      const msg = event.message as
        | { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> }
        | undefined;
      if (!msg?.content) return null;
      const results: ParsedEntry[] = [];
      for (const block of msg.content) {
        if (block.type === "thinking" && block.text) {
          const preview = block.text.slice(0, 100) + (block.text.length > 100 ? "…" : "");
          results.push({ kind: "system", text: `Thinking: ${preview}` });
        } else if (block.type === "text" && block.text) {
          results.push({ kind: "output", text: block.text });
        } else if (block.type === "tool_use" && block.name) {
          const summary = summarizeToolInput(block.name, (block.input as Record<string, unknown>) ?? {});
          results.push({
            kind: "tool",
            text: summary ? `${block.name} — ${summary}` : block.name,
            toolName: block.name,
          });
        }
      }
      return results.length ? results : null;
    }
    case "stderr": {
      const txt = String(event.text ?? "").trim();
      return txt ? { kind: "error", text: txt } : null;
    }
    case "result": {
      const txt = String(event.result ?? "").trim();
      return txt ? { kind: "result", text: txt } : null;
    }
    case "system": {
      if (event.subtype === "init") {
        const model = String(event.model ?? "");
        return { kind: "system", text: `Session started${model ? ` · ${model}` : ""}` };
      }
      if (event.subtype === "watchdog") {
        return { kind: "system", text: String(event.message ?? "") };
      }
      if (event.subtype === "paused" || event.subtype === "resumed") {
        return { kind: "system", text: String(event.message ?? event.subtype) };
      }
      return null;
    }
    case "user_prompt": {
      const txt = String(event.text ?? "").trim();
      return txt ? { kind: "user", text: txt } : null;
    }
    default:
      return null;
  }
}

export function flattenEntry(entry: AgentLogEntry): Array<FlatEntry> {
  const result = parseEntry(entry.event);
  if (!result) return [];
  const parsed = Array.isArray(result) ? result : [result];
  return parsed.map((p, i) => ({
    ...entry,
    id: `${entry.id}-${i}`,
    parsed: p,
  }));
}

export const KIND_STYLES: Record<
  EntryKind,
  { rowHover: string; prefix: string; prefixColor: string; textColor: string }
> = {
  output: {
    rowHover: "hover:bg-zinc-900/50",
    prefix: "▸",
    prefixColor: "text-emerald-500",
    textColor: "text-zinc-200",
  },
  error: {
    rowHover: "hover:bg-red-950/20",
    prefix: "✕",
    prefixColor: "text-red-400",
    textColor: "text-red-300",
  },
  system: {
    rowHover: "hover:bg-zinc-900/50",
    prefix: "·",
    prefixColor: "text-zinc-600",
    textColor: "text-zinc-500",
  },
  tool: {
    rowHover: "hover:bg-zinc-900/50",
    prefix: "⬡",
    prefixColor: "text-cyan-500",
    textColor: "text-cyan-300/80",
  },
  result: {
    rowHover: "hover:bg-emerald-950/20",
    prefix: "✓",
    prefixColor: "text-emerald-400",
    textColor: "text-emerald-300",
  },
  user: {
    rowHover: "hover:bg-blue-950/20",
    prefix: "→",
    prefixColor: "text-blue-400",
    textColor: "text-blue-200",
  },
};

// ─── Log row ──────────────────────────────────────────────────────────────────

interface LogRowProps {
  entry: FlatEntry;
}

export const LogRow = memo(function LogRow({ entry }: LogRowProps) {
  const color = agentColor(entry.agentId);
  const style = KIND_STYLES[entry.parsed.kind];
  const ts = entry.timestamp.toTimeString().slice(0, 8);

  return (
    <div
      className={`flex items-baseline gap-0 px-4 py-[2px] min-h-[22px] font-mono text-xs leading-relaxed group transition-colors ${style.rowHover}`}
    >
      <time
        dateTime={entry.timestamp.toISOString()}
        className="shrink-0 w-[58px] text-zinc-600 tabular-nums select-none"
      >
        {ts}
      </time>

      <span
        className={`shrink-0 inline-block mr-2 px-1.5 py-[1px] rounded text-[10px] font-medium border ${color.text} ${color.bg} ${color.border} max-w-[120px] truncate`}
        title={entry.agentName}
      >
        {entry.agentName}
      </span>

      <span className={`shrink-0 mr-2 w-3 text-center select-none ${style.prefixColor}`}>{style.prefix}</span>

      <span className={`${style.textColor} break-all whitespace-pre-wrap leading-snug`}>{entry.parsed.text}</span>
    </div>
  );
});

// ─── Filter types ─────────────────────────────────────────────────────────────

export const FILTER_KINDS: { label: string; kinds: EntryKind[] }[] = [
  { label: "All", kinds: ["output", "error", "system", "tool", "result", "user"] },
  { label: "Output", kinds: ["output", "result"] },
  { label: "Errors", kinds: ["error"] },
  { label: "Tools", kinds: ["tool"] },
  { label: "System", kinds: ["system", "user"] },
];

// ─── Stable Virtuoso spacer ───────────────────────────────────────────────────
export const VirtuosoFooter = () => <div className="h-2" />;
export const virtuosoComponents = { Footer: VirtuosoFooter };
