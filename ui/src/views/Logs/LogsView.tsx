"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Header } from "../../components/Header";
import { MessageFeed } from "../../components/MessageFeed";
import { Sidebar } from "../../components/Sidebar";
import { useAgentPolling } from "../../hooks/useAgentPolling";
import { useAllAgentLogs } from "../../hooks/useAllAgentLogs";
import { useApi } from "../../hooks/useApi";
import { useKillSwitchContext } from "../../killSwitch";
import {
  FILTER_KINDS,
  LogRow,
  flattenEntry,
  virtuosoComponents,
} from "./LogsComponents";

// ─── Main view ────────────────────────────────────────────────────────────────

type LogTab = "logs" | "messages";

export function LogsView() {
  const { agents } = useAgentPolling();
  const killSwitch = useKillSwitchContext();
  const api = useApi();
  const { entries, connected, error, clearEntries, reconnect } = useAllAgentLogs(100);

  const [activeTab, setActiveTab] = useState<LogTab>("logs");
  const [filterKindIdx, setFilterKindIdx] = useState(0);
  const [filterAgentId, setFilterAgentId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const prevCountRef = useRef(0);
  const userScrolledUpRef = useRef(false);
  const isAtBottomRef = useRef(true);

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    document.title = "Logs - AgentManager";
  }, []);

  const flatEntries = useMemo(() => entries.flatMap(flattenEntry), [entries]);

  const { kinds: activeKinds } = FILTER_KINDS[filterKindIdx];

  const filtered = useMemo(() => {
    return flatEntries.filter((e) => {
      if (filterAgentId && e.agentId !== filterAgentId) return false;
      if (!activeKinds.includes(e.parsed.kind)) return false;
      return true;
    });
  }, [flatEntries, filterAgentId, activeKinds]);

  const seenAgents = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) map.set(e.agentId, e.agentName);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [entries]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on filter change only
  useEffect(() => {
    prevCountRef.current = filtered.length;
    setNewCount(0);
  }, [filterKindIdx, filterAgentId]);

  useEffect(() => {
    const count = filtered.length;
    if (prevCountRef.current > 0 && count > prevCountRef.current && !isAtBottomRef.current) {
      setNewCount((c) => c + (count - prevCountRef.current));
    }
    prevCountRef.current = count;
  }, [filtered.length]);

  useEffect(() => {
    if (isAtBottom) {
      setNewCount(0);
      userScrolledUpRef.current = false;
    }
  }, [isAtBottom]);

  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    setNewCount(0);
    virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
  }, []);

  const handleAtBottom = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom);
    isAtBottomRef.current = atBottom;
  }, []);

  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && !isAtBottomRef.current) {
        userScrolledUpRef.current = true;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const followOutput = autoScroll ? ("smooth" as const) : (false as const);

  const handleClear = useCallback(() => {
    clearEntries();
    prevCountRef.current = 0;
    setNewCount(0);
  }, [clearEntries]);

  const handleReconnect = useCallback(() => {
    setFilterAgentId(null);
    reconnect();
  }, [reconnect]);

  return (
    <div className="h-screen flex flex-col">
      <Header agentCount={agents.length} killSwitch={killSwitch} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar agents={agents} activeId={null} />
        <main id="main-content" className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          {/* Tab bar */}
          <div className="shrink-0 flex items-center flex-wrap gap-0 px-2 sm:px-4 border-b border-zinc-800 bg-zinc-900/40">
            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === "logs"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Logs
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("messages")}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === "messages"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Messages
            </button>

            {/* Logs toolbar — only shown on logs tab */}
            {activeTab === "logs" && (
              <>
                <div className="w-px h-4 bg-zinc-700 mx-3" />

                {/* Connection status */}
                <span
                  className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full mr-3 ${
                    connected
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      connected ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
                    }`}
                  />
                  {connected ? "Live" : "Connecting…"}
                </span>
                {error && <span className="text-[10px] text-amber-400 mr-2">{error}</span>}

                {/* Kind filter pills */}
                <div className="flex items-center gap-1">
                  {FILTER_KINDS.map((f, i) => (
                    <button
                      key={f.label}
                      type="button"
                      onClick={() => setFilterKindIdx(i)}
                      className={`px-2.5 py-1 rounded text-xs transition-colors ${
                        filterKindIdx === i
                          ? "bg-zinc-700 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Agent filter */}
                <div className="relative ml-2">
                  <select
                    value={filterAgentId ?? ""}
                    onChange={(e) => setFilterAgentId(e.target.value || null)}
                    className="appearance-none bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs rounded px-2.5 py-1 pr-6 focus:outline-none focus:border-zinc-600 cursor-pointer max-w-[180px] truncate"
                    aria-label="Filter by agent"
                  >
                    <option value="">All agents</option>
                    {seenAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <svg
                    className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500"
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>

                <div className="flex-1" />

                {/* Auto-scroll toggle */}
                <button
                  type="button"
                  onClick={() => setAutoScroll((v) => !v)}
                  title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                    autoScroll
                      ? "bg-blue-600/10 text-blue-400 border border-blue-600/20"
                      : "text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-700"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M6 2v8M3 7l3 3 3-3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Tail
                </button>

                {/* Clear */}
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-2.5 py-1 rounded text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors border border-transparent hover:border-zinc-700"
                >
                  Clear
                </button>

                {/* Reconnect */}
                <button
                  type="button"
                  onClick={handleReconnect}
                  title="Reconnect to log stream"
                  className="px-2.5 py-1 rounded text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors border border-transparent hover:border-zinc-700"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M10 6a4 4 0 1 1-1.17-2.83M10 2v3H7"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Messages tab */}
          {activeTab === "messages" && (
            <div className="flex-1 overflow-hidden p-6">
              <MessageFeed api={api} agents={agents} />
            </div>
          )}

          {/* Logs tab */}
          {activeTab === "logs" && (
            <>
              <div ref={wrapperRef} className="flex-1 overflow-hidden relative">
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <svg
                      width="40"
                      height="40"
                      viewBox="0 0 40 40"
                      fill="none"
                      className="text-zinc-700"
                      aria-hidden="true"
                    >
                      <rect x="6" y="8" width="28" height="4" rx="2" fill="currentColor" opacity="0.5" />
                      <rect x="6" y="16" width="20" height="4" rx="2" fill="currentColor" opacity="0.3" />
                      <rect x="6" y="24" width="24" height="4" rx="2" fill="currentColor" opacity="0.2" />
                      <rect x="6" y="32" width="14" height="4" rx="2" fill="currentColor" opacity="0.1" />
                    </svg>
                    <p className="text-zinc-600 text-sm">
                      {connected ? "Waiting for log entries…" : "Connecting to log stream…"}
                    </p>
                  </div>
                ) : (
                  <Virtuoso
                    ref={virtuosoRef}
                    data={filtered}
                    followOutput={followOutput}
                    overscan={200}
                    initialTopMostItemIndex={Math.max(0, filtered.length - 1)}
                    atBottomThreshold={40}
                    atBottomStateChange={handleAtBottom}
                    className="h-full"
                    itemContent={(_index, entry) => <LogRow entry={entry} />}
                    components={virtuosoComponents}
                  />
                )}

                {/* New entries badge */}
                {!isAtBottom && newCount > 0 && (
                  <button
                    type="button"
                    onClick={scrollToBottom}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-700/90 hover:bg-zinc-600/90 border border-zinc-600 text-zinc-200 text-xs shadow-lg backdrop-blur-sm transition-all"
                    aria-label={`${newCount} new entries, scroll to bottom`}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="2 4 6 8 10 4" />
                    </svg>
                    {newCount} new
                  </button>
                )}
              </div>

              {/* Status bar */}
              <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-zinc-800/60 bg-zinc-900/30 text-[10px] text-zinc-600 font-mono">
                <span>
                  {filtered.length.toLocaleString()} entries
                  {filterAgentId && " (filtered)"}
                </span>
                <span className="flex items-center gap-3">
                  {seenAgents.length > 0 && (
                    <span>
                      {seenAgents.length} agent{seenAgents.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span>{autoScroll ? "auto-scroll on" : "auto-scroll off"}</span>
                </span>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
