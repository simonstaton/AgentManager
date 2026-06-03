"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamEvent } from "../api";
import { useApi } from "./useApi";

export interface AgentLogEntry {
  id: string;
  agentId: string;
  agentName: string;
  event: StreamEvent;
  timestamp: Date;
}

const MAX_ENTRIES = 5000;

/** Returns a live-updating log stream from all agents. */
export function useAllAgentLogs(tail = 100) {
  const api = useApi();
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const counterRef = useRef(0);
  // entriesRef holds the canonical array. We mutate it in place and publish
  // a new reference only when React needs to re-render (batched via rAF).
  const entriesRef = useRef<AgentLogEntry[]>([]);
  const rafRef = useRef<number | null>(null);
  const tailRef = useRef(tail);
  tailRef.current = tail;

  const flushEntries = useCallback(() => {
    rafRef.current = null;
    setEntries(entriesRef.current.slice());
  }, []);

  const connect = useCallback(async () => {
    abortRef.current?.();
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const { stream, abort } = api.allAgentLogsStream({ tail: tailRef.current });
    abortRef.current = abort;
    setConnected(false);
    setError(null);

    try {
      const reader = (await stream).getReader();
      setConnected(true);
      retryCountRef.current = 0;

      let cleanClose = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          cleanClose = true;
          break;
        }

        const ev = value as StreamEvent & { agentId: string; agentName: string; _ts?: number };
        if (!ev.type) continue;

        const entry: AgentLogEntry = {
          id: `${ev.agentId}-${counterRef.current++}`,
          agentId: ev.agentId,
          agentName: ev.agentName,
          event: ev,
          timestamp: ev._ts ? new Date(ev._ts) : new Date(),
        };

        entriesRef.current.push(entry);
        if (entriesRef.current.length > MAX_ENTRIES) {
          entriesRef.current = entriesRef.current.slice(-MAX_ENTRIES);
        }

        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(flushEntries);
        }
      }
      if (cleanClose) {
        retryTimerRef.current = setTimeout(connect, 1000);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setConnected(false);
      const delay = Math.min(1000 * 2 ** retryCountRef.current, 30_000);
      retryCountRef.current++;
      retryTimerRef.current = setTimeout(connect, delay);
      setError("Connection lost — reconnecting...");
    } finally {
      setConnected(false);
    }
  }, [api, flushEntries]);

  useEffect(() => {
    connect();
    return () => {
      abortRef.current?.();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [connect]);

  const clearEntries = useCallback(() => {
    entriesRef.current = [];
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setEntries([]);
  }, []);

  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    entriesRef.current = [];
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setEntries([]);
    connect();
  }, [connect]);

  return { entries, connected, error, clearEntries, reconnect };
}
