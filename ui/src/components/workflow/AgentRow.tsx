"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkflowAgent } from "../../api";
import { Badge } from "../ui/badge";

interface StatusConfig {
  label: string;
  badgeVariant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";
  dotClass: string;
  pulse: boolean;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  starting: {
    label: "Starting",
    badgeVariant: "warning",
    dotClass: "bg-amber-400",
    pulse: true,
  },
  running: {
    label: "Running",
    badgeVariant: "info",
    dotClass: "bg-cyan-400",
    pulse: true,
  },
  completed: {
    label: "Done",
    badgeVariant: "success",
    dotClass: "bg-emerald-400",
    pulse: false,
  },
  failed: {
    label: "Failed",
    badgeVariant: "destructive",
    dotClass: "bg-red-500",
    pulse: false,
  },
  cancelled: {
    label: "Cancelled",
    badgeVariant: "secondary",
    dotClass: "bg-zinc-500",
    pulse: false,
  },
  idle: {
    label: "Idle",
    badgeVariant: "secondary",
    dotClass: "bg-zinc-500",
    pulse: false,
  },
  recovering: {
    label: "Recovering",
    badgeVariant: "warning",
    dotClass: "bg-amber-400",
    pulse: true,
  },
};

const FALLBACK_STATUS: StatusConfig = {
  label: "Unknown",
  badgeVariant: "secondary",
  dotClass: "bg-zinc-500",
  pulse: false,
};

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface AgentRowProps {
  agent: WorkflowAgent;
}

/**
 * A single row representing an agent in the workflow view.
 * Displays status indicator, name/role, current task, and elapsed time.
 */
export function AgentRow({ agent }: AgentRowProps) {
  const status = agent.status ?? "idle";
  const config = STATUS_CONFIG[status] ?? FALLBACK_STATUS;
  const isActive = status === "starting" || status === "running" || status === "recovering";

  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      startedAtRef.current = null;
      setElapsed(0);
      return;
    }
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }
    const intervalStart = startedAtRef.current;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - intervalStart) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <div className="flex items-center gap-3 py-1.5 px-1">
      {/* Status dot */}
      <div
        className={`h-2 w-2 flex-shrink-0 rounded-full ${config.dotClass} ${config.pulse ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />

      {/* Name + role + current task */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-zinc-200" title={agent.name}>
            {agent.name || agent.role}
          </span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {agent.role}
          </Badge>
        </div>
        {agent.currentTask && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={agent.currentTask}>
            {agent.currentTask}
          </p>
        )}
      </div>

      {/* Status label + elapsed */}
      <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
        <Badge variant={config.badgeVariant} className="text-[10px]">
          {config.label}
        </Badge>
        {isActive && elapsed > 0 && (
          <span className="tabular-nums text-[10px] text-muted-foreground">{formatElapsed(elapsed)}</span>
        )}
      </div>
    </div>
  );
}
