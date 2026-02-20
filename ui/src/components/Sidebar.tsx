"use client";

import { Badge } from "@fanvue/ui";
import Link from "next/link";
import type { Agent } from "../api";
import { STATUS_BADGE_VARIANT } from "../constants";
import { useCostPolling } from "../hooks/useCostPolling";

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

interface SidebarProps {
  agents: Agent[];
  activeId: string | null;
}

export function Sidebar({ agents, activeId }: SidebarProps) {
  const cost = useCostPolling();

  return (
    <aside
      className="w-56 flex-shrink-0 border-r border-zinc-800 bg-zinc-900/30 flex flex-col"
      aria-label="Agent navigation"
    >
      <div className="p-3 flex-1 overflow-y-auto">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 px-2">Agents</p>
        {agents.length === 0 && <p className="text-xs text-zinc-400 px-2">No active agents</p>}
        <nav aria-label="Agent list" className="space-y-0.5">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}/`}
              aria-current={activeId === agent.id ? "page" : undefined}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded text-sm text-left transition-colors ${
                activeId === agent.id
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              <Badge
                variant={STATUS_BADGE_VARIANT[agent.status] || "default"}
                leftDot
                className="[&]:p-0 [&]:bg-transparent [&]:text-transparent [&]:overflow-hidden [&]:w-1.5 [&]:h-1.5 [&]:min-w-0"
              />
              <span className="truncate">{agent.name}</span>
            </Link>
          ))}
        </nav>
      </div>

      {cost && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Session</span>
            <span className="text-sm font-mono font-semibold text-zinc-100">{formatCost(cost.totalCost)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">All time</span>
            <span className="text-sm font-mono font-semibold text-zinc-400">{formatCost(cost.allTime.totalCost)}</span>
          </div>
          <div className="mt-1.5 text-[10px] text-zinc-600 font-mono">{formatTokens(cost.totalTokens)} tokens</div>
        </div>
      )}
    </aside>
  );
}
