"use client";

import type { VariantProps } from "class-variance-authority";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStage = "analyzing" | "implementing" | "creating-pr";

export interface WorkflowAgent {
  id: string;
  name: string;
  role: string;
  status?: string;
  currentTask?: string;
}

export interface WorkflowForPanel {
  id: string;
  status: "starting" | "running" | "completed" | "failed" | "cancelled" | "recovering";
  agents: WorkflowAgent[];
  error?: string;
  createdAt: string;
  /** Optional: current implementation stage */
  stage?: WorkflowStage;
  /** Optional: issue identifier (e.g. "TEAM-123") */
  issueId?: string;
  /** Optional: issue title */
  issueTitle?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const STAGES: Array<{ key: WorkflowStage; label: string }> = [
  { key: "analyzing", label: "Analyzing" },
  { key: "implementing", label: "Implementing" },
  { key: "creating-pr", label: "PR Ready" },
];

const STAGE_ORDER: WorkflowStage[] = ["analyzing", "implementing", "creating-pr"];

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const OVERALL_STATUS: Record<WorkflowForPanel["status"], { label: string; badgeVariant: BadgeVariant }> = {
  starting: { label: "Starting up…", badgeVariant: "warning" },
  running: { label: "Running", badgeVariant: "info" },
  completed: { label: "Completed", badgeVariant: "success" },
  failed: { label: "Failed", badgeVariant: "destructive" },
  cancelled: { label: "Cancelled", badgeVariant: "secondary" },
  recovering: { label: "Recovering…", badgeVariant: "warning" },
} as const;

const AGENT_STATUS_CONFIG: Record<string, { label: string; textColor: string; dotClass: string; pulse: boolean }> = {
  starting: { label: "Starting", textColor: "text-amber-400", dotClass: "bg-amber-400", pulse: true },
  running: { label: "Running", textColor: "text-cyan-400", dotClass: "bg-emerald-500", pulse: true },
  completed: { label: "Done", textColor: "text-emerald-400", dotClass: "bg-emerald-500", pulse: false },
  failed: { label: "Failed", textColor: "text-red-400", dotClass: "bg-red-500", pulse: false },
  cancelled: { label: "Cancelled", textColor: "text-zinc-500", dotClass: "bg-zinc-600", pulse: false },
  idle: { label: "Idle", textColor: "text-zinc-500", dotClass: "bg-zinc-600", pulse: false },
  recovering: { label: "Recovering", textColor: "text-amber-400", dotClass: "bg-amber-400", pulse: true },
};

const FALLBACK_AGENT_STATUS = {
  label: "Unknown",
  textColor: "text-zinc-500",
  dotClass: "bg-zinc-600",
  pulse: false,
};

function formatElapsedMinutes(createdAt: string): string {
  const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (elapsed < 1) return "< 1 min";
  return `${elapsed} min`;
}

function formatElapsedSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// WorkflowStageIndicator
// ---------------------------------------------------------------------------

interface WorkflowStageIndicatorProps {
  stage?: WorkflowStage;
  workflowStatus: WorkflowForPanel["status"];
}

function WorkflowStageIndicator({ stage, workflowStatus }: WorkflowStageIndicatorProps) {
  const currentIdx = stage ? STAGE_ORDER.indexOf(stage) : -1;
  const isComplete = workflowStatus === "completed";

  return (
    <div className="mt-2 flex items-center">
      {STAGES.map((s, i) => {
        const stageIdx = STAGE_ORDER.indexOf(s.key);
        const done = isComplete || stageIdx < currentIdx;
        const active = stageIdx === currentIdx;
        return (
          <div key={s.key} className="flex flex-1 items-center">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full",
                  done && "bg-emerald-600",
                  active && "animate-pulse bg-cyan-500",
                  !done && !active && "border border-zinc-700 bg-zinc-800",
                )}
              >
                {done && (
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                    <path
                      d="M1.5 4l2 2 3-3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <span className={cn("text-[10px]", active ? "font-medium text-cyan-400" : "text-zinc-500")}>
                {s.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={cn("mx-2 h-px flex-1", done ? "bg-emerald-700/50" : "bg-zinc-700")} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkflowAgentRow
// ---------------------------------------------------------------------------

interface WorkflowAgentRowProps {
  agent: WorkflowAgent;
}

function WorkflowAgentRow({ agent }: WorkflowAgentRowProps) {
  const status = agent.status ?? "idle";
  const config = AGENT_STATUS_CONFIG[status] ?? FALLBACK_AGENT_STATUS;
  const isActive = status === "starting" || status === "running";

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
    <div className="flex items-center gap-3 py-1.5 px-2">
      <div
        className={cn("h-2 w-2 flex-shrink-0 rounded-full", config.dotClass, config.pulse && "animate-pulse")}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-zinc-200" title={agent.name}>
            {agent.name || agent.role}
          </span>
          <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
            {agent.role}
          </Badge>
        </div>
        {agent.currentTask && (
          <p className="mt-0.5 truncate text-xs text-zinc-500" title={agent.currentTask}>
            {agent.currentTask}
          </p>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
        <span className={cn("text-xs font-medium", config.textColor)}>{config.label}</span>
        {isActive && elapsed > 0 && (
          <span className="tabular-nums text-[10px] text-zinc-600">{formatElapsedSeconds(elapsed)}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressPanel (main export)
// ---------------------------------------------------------------------------

export interface ProgressPanelProps {
  workflow: WorkflowForPanel;
  onCancel: () => void;
  className?: string;
}

export function ProgressPanel({ workflow, onCancel, className }: ProgressPanelProps) {
  const statusConfig = OVERALL_STATUS[workflow.status] ?? OVERALL_STATUS.running;
  const isActive = workflow.status === "starting" || workflow.status === "running";

  // Re-render elapsed time every minute while active
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, [isActive]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const runningCount = workflow.agents.filter((a) => a.status === "running" || a.status === "starting").length;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Issue info */}
      {(workflow.issueId || workflow.issueTitle) && (
        <div>
          {workflow.issueId && <p className="font-mono text-xs text-zinc-500">{workflow.issueId}</p>}
          {workflow.issueTitle && (
            <p className="mt-0.5 line-clamp-2 text-sm font-medium text-zinc-100">{workflow.issueTitle}</p>
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isActive && (
              <div className="flex gap-0.5" aria-hidden="true">
                <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" style={{ animationDelay: "300ms" }} />
              </div>
            )}
            <Badge variant={statusConfig.badgeVariant}>{statusConfig.label}</Badge>
          </div>
          <span className="text-xs text-zinc-500">
            {isActive && `${formatElapsedMinutes(workflow.createdAt)} elapsed · `}
            {runningCount > 0 && `${runningCount} agent${runningCount !== 1 ? "s" : ""}`}
          </span>
        </div>
        {(workflow.stage || isActive) && (
          <WorkflowStageIndicator stage={workflow.stage} workflowStatus={workflow.status} />
        )}
      </div>

      {/* Agents */}
      <section aria-label="Active agents">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Agents</p>
        {workflow.agents.length > 0 ? (
          <div
            className="divide-y divide-zinc-800/60 rounded-md border border-zinc-800"
            role="status"
            aria-live="polite"
            aria-label="Agent status updates"
          >
            {workflow.agents.map((agent) => (
              <WorkflowAgentRow key={agent.id} agent={agent} />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-md border border-zinc-800 py-6">
            <p className="text-xs text-zinc-500">Spawning agents…</p>
          </div>
        )}
      </section>

      {/* Error */}
      {workflow.error && <p className="text-xs text-red-400">{workflow.error}</p>}

      {/* Cancel */}
      {isActive && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCancel}
          aria-label={`Cancel workflow${workflow.issueId ? ` for ${workflow.issueId}` : ""}`}
          className="w-full border-zinc-700 text-zinc-400 hover:border-red-900 hover:text-red-400"
        >
          Cancel Workflow
        </Button>
      )}
    </div>
  );
}
