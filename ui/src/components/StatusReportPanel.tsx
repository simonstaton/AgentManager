"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Agent, AgentMessage } from "../api";
import { getStatusDotColor } from "../constants";

interface StatusReportPanelProps {
  agents: Agent[];
  requestedAt: number;
  onClose: () => void;
}

export function StatusReportPanel({ agents, requestedAt, onClose }: StatusReportPanelProps) {
  const [reports, setReports] = useState<Map<string, string>>(new Map());
  const [sseDisconnected, setSseDisconnected] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runningAgents = useMemo(
    () => agents.filter((a) => a.status === "running" || a.status === "idle" || a.status === "stalled"),
    [agents],
  );
  const otherAgents = useMemo(
    () => agents.filter((a) => a.status !== "running" && a.status !== "idle" && a.status !== "stalled"),
    [agents],
  );

  // Polling fallback — fetch messages to 'user' since requestedAt
  const pollMessages = useCallback(async () => {
    try {
      const since = new Date(requestedAt).toISOString();
      const res = await fetch(`/api/messages?to=user&since=${encodeURIComponent(since)}&limit=50`);
      if (!res.ok) return;
      const msgs: AgentMessage[] = await res.json();
      setReports((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const msg of msgs) {
          if ((msg.type === "result" || msg.type === "status") && !next.has(msg.from)) {
            next.set(msg.from, msg.content);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch {
      // Polling failed silently — will retry on next interval
    }
  }, [requestedAt]);

  // Listen for agent responses via SSE with polling fallback
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/messages/stream?agentId=user");
      es.onmessage = (event) => {
        try {
          const msg: AgentMessage = JSON.parse(event.data);
          if (
            (msg.type === "result" || msg.type === "status") &&
            msg.to === "user" &&
            new Date(msg.createdAt).getTime() >= requestedAt
          ) {
            setReports((prev) => {
              const next = new Map(prev);
              next.set(msg.from, msg.content);
              return next;
            });
          }
        } catch {
          // Ignore malformed SSE data
        }
      };

      es.onerror = () => {
        setSseDisconnected(true);
        // Start polling fallback if not already running
        if (!pollRef.current) {
          pollRef.current = setInterval(pollMessages, 5000);
        }
      };

      es.onopen = () => {
        setSseDisconnected(false);
        // SSE reconnected — stop polling, do a catch-up fetch
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        pollMessages();
      };
    } catch {
      // EventSource not supported — fall back to polling
      pollRef.current = setInterval(pollMessages, 5000);
    }

    return () => {
      es?.close();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [requestedAt, pollMessages]);

  // Auto-scroll when new reports arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on reports change
  useLayoutEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [reports]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reportedRunning = useMemo(() => {
    const ids = new Set(runningAgents.map((a) => a.id));
    let count = 0;
    for (const key of reports.keys()) {
      if (ids.has(key)) count++;
    }
    return count;
  }, [reports, runningAgents]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop handles click-outside-to-close
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-report-title"
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 id="status-report-title" className="text-sm font-semibold text-zinc-100">
              Agent Status Reports
            </h2>
            <p className="text-[10px] text-zinc-500 mt-0.5" aria-live="polite">
              {reportedRunning} of {runningAgents.length} agent{runningAgents.length !== 1 ? "s" : ""} reported
              {sseDisconnected && <span className="text-amber-500 ml-1">(reconnecting...)</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            aria-label="Close status reports"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Reports list */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {agents.length === 0 && <p className="text-xs text-zinc-500 text-center py-6">No agents active</p>}

          {/* Active agents first */}
          {runningAgents.map((agent) => {
            const hasReport = reports.has(agent.id);
            const content = hasReport ? reports.get(agent.id) : agent.currentTask || "No active task";

            return (
              <div key={agent.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDotColor(agent.status)}`} />
                  <span className="text-xs font-medium text-zinc-200 truncate">{agent.name}</span>
                  <span className="text-[10px] text-zinc-500">{agent.status}</span>
                  <span className="ml-auto flex-shrink-0">
                    {hasReport ? (
                      <span className="text-[10px] font-medium text-emerald-400">reported</span>
                    ) : (
                      <span className="text-[10px] text-zinc-500 animate-pulse">waiting...</span>
                    )}
                  </span>
                </div>
                <div
                  className={`text-xs leading-relaxed whitespace-pre-wrap break-words rounded px-2.5 py-2 ${
                    hasReport
                      ? "bg-zinc-800/60 text-zinc-300 border-l-2 border-emerald-500/50"
                      : "bg-zinc-800/30 text-zinc-500 border-l-2 border-zinc-700"
                  }`}
                >
                  {content}
                  {!hasReport && agent.currentTask && (
                    <span className="block mt-1 text-[10px] text-zinc-600 italic">(awaiting detailed report...)</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Inactive agents */}
          {otherAgents.length > 0 && (
            <>
              {runningAgents.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 border-t border-zinc-800" />
                  <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Inactive</span>
                  <div className="flex-1 border-t border-zinc-800" />
                </div>
              )}
              {otherAgents.map((agent) => (
                <div key={agent.id} className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-3 opacity-60">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDotColor(agent.status)}`} />
                    <span className="text-xs font-medium text-zinc-400 truncate">{agent.name}</span>
                    <span className="text-[10px] text-zinc-600">{agent.status}</span>
                    <span className="ml-auto text-[10px] text-zinc-600">skipped</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
