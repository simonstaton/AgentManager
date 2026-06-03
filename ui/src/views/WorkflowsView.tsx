"use client";

import { useCallback, useEffect, useState } from "react";
import type { LinearWorkflow } from "../api";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { useToast } from "../components/Toast";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { AgentRow } from "../components/workflow/AgentRow";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useApi } from "../hooks/useApi";
import { useKillSwitchContext } from "../killSwitch";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const WORKFLOW_STATUS_VARIANT: Record<
  LinearWorkflow["status"],
  "default" | "secondary" | "destructive" | "success" | "warning" | "info" | "outline"
> = {
  validating: "warning",
  rejected: "destructive",
  starting: "warning",
  running: "info",
  awaiting_confirm: "warning",
  grading: "info",
  needs_human: "warning",
  completed: "success",
  failed: "destructive",
  cancelled: "secondary",
};

const WORKFLOW_STATUS_LABELS: Record<LinearWorkflow["status"], string> = {
  validating: "Validating",
  rejected: "Rejected",
  starting: "Starting",
  running: "Running",
  awaiting_confirm: "Awaiting Confirm",
  grading: "Grading",
  needs_human: "Needs Human",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

interface WorkflowCardProps {
  workflow: LinearWorkflow;
  onCancel: (id: string) => void;
}

function WorkflowCard({ workflow, onCancel }: WorkflowCardProps) {
  const isActive =
    workflow.status === "starting" ||
    workflow.status === "running" ||
    workflow.status === "validating" ||
    workflow.status === "grading";
  const isCancellable = isActive || workflow.status === "awaiting_confirm";

  const issueId = workflow.linearUrl?.split("/").pop();

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {issueId && <span className="text-xs font-mono text-muted-foreground">{issueId}</span>}
            <Badge variant={WORKFLOW_STATUS_VARIANT[workflow.status]}>{WORKFLOW_STATUS_LABELS[workflow.status]}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground truncate" title={workflow.repository}>
            {workflow.repository}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground">{timeAgo(workflow.createdAt)}</span>
          {isCancellable && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onCancel(workflow.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              Cancel
            </Button>
          )}
          {workflow.prUrl && (
            <a
              href={workflow.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              View PR
            </a>
          )}
        </div>
      </div>

      {/* Error message */}
      {workflow.error && <p className="mb-2 text-xs text-destructive">{workflow.error}</p>}

      {/* Agent rows */}
      {workflow.agents.length > 0 && (
        <div className="mt-2 divide-y divide-border/50">
          {workflow.agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkflowsView() {
  const api = useApi();
  const { agents } = useAgentPolling();
  const killSwitch = useKillSwitchContext();
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState<LinearWorkflow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkflows = useCallback(async () => {
    try {
      const data = await api.fetchWorkflows();
      setWorkflows(data);
    } catch {
      // Ignore poll errors silently; show on first load
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    document.title = "Workflows - AgentManager";
    fetchWorkflows();
    const interval = setInterval(fetchWorkflows, 5000);
    return () => clearInterval(interval);
  }, [fetchWorkflows]);

  const handleCancel = useCallback(
    async (id: string) => {
      try {
        await api.cancelWorkflow(id);
        setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, status: "cancelled" as const } : w)));
        toast("Workflow cancelled", "info");
      } catch {
        toast("Failed to cancel workflow", "error");
      }
    },
    [api, toast],
  );

  const active = workflows.filter(
    (w) =>
      w.status === "starting" ||
      w.status === "running" ||
      w.status === "validating" ||
      w.status === "grading" ||
      w.status === "awaiting_confirm",
  );
  const finished = workflows.filter(
    (w) =>
      w.status === "completed" ||
      w.status === "failed" ||
      w.status === "cancelled" ||
      w.status === "rejected" ||
      w.status === "needs_human",
  );

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar agents={agents} activeId={null} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header agentCount={agents.length} killSwitch={killSwitch} />

        <main id="main-content" className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Page header */}
            <div>
              <h1 className="text-xl font-semibold text-foreground">Workflows</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">Linear ticket workflows managed by agent teams</p>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
              </div>
            )}

            {!loading && workflows.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
                <p className="text-sm font-medium text-foreground">No workflows yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Workflows appear here when a Linear ticket is submitted.
                </p>
              </div>
            )}

            {active.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Active ({active.length})
                </h2>
                <div className="space-y-3">
                  {active.map((w) => (
                    <WorkflowCard key={w.id} workflow={w} onCancel={handleCancel} />
                  ))}
                </div>
              </section>
            )}

            {finished.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  History ({finished.length})
                </h2>
                <div className="space-y-3">
                  {finished.map((w) => (
                    <WorkflowCard key={w.id} workflow={w} onCancel={handleCancel} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
