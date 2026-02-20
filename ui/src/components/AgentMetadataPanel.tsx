"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMetadata } from "../api";
import { useApi } from "../hooks/useApi";

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatRepo(url: string): string {
  return url
    .replace(/\.git$/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^git@[^:]+:/, "");
}

interface MetadataRowProps {
  label: string;
  value: string | null;
  mono?: boolean;
}

function MetadataRow({ label, value, mono }: MetadataRowProps) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-zinc-500 text-xs shrink-0">{label}</span>
      <span className={`text-zinc-300 text-xs text-right truncate ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </span>
    </div>
  );
}

export function AgentMetadataPanel({ agentId }: { agentId: string }) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [metadata, setMetadata] = useState<AgentMetadata | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);

  const fetchMetadata = useCallback(async () => {
    try {
      const data = await apiRef.current.getAgentMetadata(agentId);
      setMetadata(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, [agentId]);

  useEffect(() => {
    if (!expanded) return;
    fetchMetadata();
    const interval = setInterval(fetchMetadata, 10_000);
    return () => clearInterval(interval);
  }, [expanded, fetchMetadata]);

  return (
    <div className="border-b border-zinc-800">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
      >
        <span>Metadata</span>
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
        <div className="px-4 pb-2 space-y-0.5">
          {error && <span className="text-xs text-zinc-500">Failed to load metadata</span>}
          {!error && !metadata && <span className="text-xs text-zinc-500">Loading...</span>}
          {metadata && (
            <>
              <MetadataRow label="PID" value={metadata.pid != null ? String(metadata.pid) : null} mono />
              <MetadataRow label="Uptime" value={formatUptime(metadata.uptime)} />
              <MetadataRow label="Model" value={metadata.model} />
              <MetadataRow label="Working Dir" value={metadata.workingDir} mono />
              <MetadataRow label="Repo" value={metadata.repo ? formatRepo(metadata.repo) : null} />
              <MetadataRow label="Branch" value={metadata.branch} mono />
              <MetadataRow label="Worktree" value={metadata.worktreePath} mono />
              <MetadataRow label="Session" value={metadata.sessionId?.slice(0, 12) ?? null} mono />
              <MetadataRow label="Tokens In" value={formatTokens(metadata.tokensIn)} />
              <MetadataRow label="Tokens Out" value={formatTokens(metadata.tokensOut)} />
              <MetadataRow label="Cost" value={`$${metadata.estimatedCost.toFixed(4)}`} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
