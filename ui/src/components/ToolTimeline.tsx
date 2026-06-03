"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolTimelineEntry } from "../api";
import { useApi } from "../hooks/useApi";

function formatDuration(ms: number | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toTimeString().slice(0, 8);
}

interface ToolTimelineProps {
  agentId: string;
}

/**
 * Collapsible panel showing the tool execution timeline for an agent.
 * Polls /api/hooks/:agentId/timeline every 5 seconds when expanded.
 */
export function ToolTimeline({ agentId }: ToolTimelineProps) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<ToolTimelineEntry[]>([]);
  const [error, setError] = useState(false);

  const fetchTimeline = useCallback(async () => {
    try {
      const data = await apiRef.current.getToolTimeline(agentId);
      setEntries(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, [agentId]);

  useEffect(() => {
    if (!expanded) return;
    fetchTimeline();
    const interval = setInterval(fetchTimeline, 5_000);
    return () => clearInterval(interval);
  }, [expanded, fetchTimeline]);

  // Show entries in reverse-chronological order
  const reversed = [...entries].reverse();

  return (
    <div className="border-b border-zinc-800">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          Tool Timeline
          {entries.length > 0 && <span className="text-[10px] text-zinc-600">({entries.length})</span>}
        </span>
        <svg
          aria-hidden="true"
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-2">
          {error && <span className="text-xs text-zinc-500">Failed to load timeline</span>}
          {!error && entries.length === 0 && <span className="text-xs text-zinc-500">No tool calls recorded yet</span>}
          {!error && reversed.length > 0 && (
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {reversed.map((entry, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable index for timeline rows
                <ToolTimelineRow key={`${entry.timestamp}-${i}`} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolTimelineRow({ entry }: { entry: ToolTimelineEntry }) {
  const isBlocked = entry.outcome === "blocked";
  return (
    <div className={`flex items-center gap-2 py-0.5 text-xs ${isBlocked ? "opacity-60" : ""}`}>
      {/* Outcome indicator */}
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${isBlocked ? "bg-red-500" : "bg-emerald-500"}`}
        title={isBlocked ? "Blocked" : "Allowed"}
      />

      {/* Tool name */}
      <span className={`font-medium shrink-0 ${isBlocked ? "text-red-400" : "text-cyan-400"}`}>{entry.tool}</span>

      {/* Input preview */}
      {entry.inputPreview && (
        <span className="text-zinc-500 font-mono truncate flex-1" title={entry.inputPreview}>
          {entry.inputPreview}
        </span>
      )}

      {/* Duration */}
      {entry.durationMs != null && (
        <span className="text-zinc-600 shrink-0 tabular-nums">{formatDuration(entry.durationMs)}</span>
      )}

      {/* Timestamp */}
      <span className="text-zinc-700 shrink-0 tabular-nums font-mono">{formatTimestamp(entry.timestamp)}</span>
    </div>
  );
}
