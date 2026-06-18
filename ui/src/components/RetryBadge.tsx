"use client";

import { useEffect, useState } from "react";

export interface RetryState {
  attempt: number;
  error_status?: number;
  error?: string;
  retry_delay_ms?: number;
}

interface RetryBadgeProps {
  retry: RetryState;
  /** If true, renders a compact inline version for AgentCard */
  compact?: boolean;
}

/**
 * Displays an API retry indicator with countdown timer.
 * Used in AgentTerminal (inline) and AgentCard (compact).
 */
export function RetryBadge({ retry, compact = false }: RetryBadgeProps) {
  const [remaining, setRemaining] = useState<number | null>(
    retry.retry_delay_ms != null ? Math.ceil(retry.retry_delay_ms / 1000) : null,
  );

  useEffect(() => {
    if (retry.retry_delay_ms == null || retry.retry_delay_ms <= 0) {
      setRemaining(null);
      return;
    }
    const endMs = Date.now() + retry.retry_delay_ms;
    setRemaining(Math.max(0, Math.ceil((endMs - Date.now()) / 1000)));
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [retry.retry_delay_ms]);

  const label = retry.error_status ? `${retry.error_status}` : "err";
  const countdownText = remaining != null && remaining > 0 ? ` ${remaining}s` : "";

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-1.5 py-0.5"
        title={retry.error || `API retry #${retry.attempt}`}
        role="status"
        aria-label={`Retrying API call (attempt ${retry.attempt})${countdownText}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" aria-hidden="true" />
        Retry #{retry.attempt} ({label}){countdownText}
      </span>
    );
  }

  return (
    <div
      className="my-1 flex items-center gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded px-3 py-1.5"
      role="status"
      aria-label={`API retry attempt ${retry.attempt}${countdownText}`}
    >
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" aria-hidden="true" />
      <span className="font-medium">
        Retrying ({label}) — attempt {retry.attempt}
      </span>
      {retry.error && <span className="text-amber-500/80 truncate">{retry.error}</span>}
      {remaining != null && remaining > 0 && <span className="ml-auto shrink-0 tabular-nums">{remaining}s</span>}
    </div>
  );
}
