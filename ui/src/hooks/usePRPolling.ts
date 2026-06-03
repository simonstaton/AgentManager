"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PullRequestItem } from "../api";
import { useApi } from "./useApi";
import { usePageVisible } from "./usePageVisible";

const PR_POLL_INTERVAL_MS = 30_000;

export function usePRPolling(intervalMs = PR_POLL_INTERVAL_MS) {
  const api = useApi();
  const [pullRequests, setPullRequests] = useState<PullRequestItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const visible = usePageVisible();
  const apiRef = useRef(api);
  apiRef.current = api;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const fetchPRs = useCallback(async (forceRefresh = false) => {
    try {
      const data = await apiRef.current.fetchPullRequests(forceRefresh);
      if (!cancelledRef.current) {
        setPullRequests(data.pullRequests);
        setError(data.error ?? null);
        setIsLoading(false);
      }
    } catch {
      if (!cancelledRef.current) {
        setError("Failed to fetch pull requests");
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!visible) return;

    cancelledRef.current = false;
    setIsLoading(true);

    fetchPRs();
    intervalRef.current = setInterval(() => fetchPRs(), intervalMs);

    return () => {
      cancelledRef.current = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible, intervalMs, fetchPRs]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    if (intervalRef.current) clearInterval(intervalRef.current);
    fetchPRs(true).then(() => {
      intervalRef.current = setInterval(() => fetchPRs(), intervalMs);
    });
  }, [fetchPRs, intervalMs]);

  return { pullRequests, isLoading, error, refresh };
}
