"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProgressPanel, type WorkflowForPanel } from "./ProgressPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by the /api/workflows endpoint */
export interface LinearWorkflow {
  id: string;
  linearUrl: string;
  repository: string;
  status: "starting" | "running" | "completed" | "failed" | "cancelled";
  agents: Array<{
    id: string;
    name: string;
    role: string;
    status?: string;
    currentTask?: string;
  }>;
  prUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDrawerProps {
  open: boolean;
  onClose: () => void;
  onStartNew: () => void;
  /** authFetch from useAuth() — caller provides to avoid duplicate auth context */
  authFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  /** toast from useToast() — caller provides */
  toast: (message: string, type?: "info" | "error" | "success") => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a LinearWorkflow to the shape ProgressPanel expects */
function toPanel(w: LinearWorkflow): WorkflowForPanel {
  const statusMap: Record<string, WorkflowForPanel["status"]> = {
    starting: "starting",
    running: "running",
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled",
  };
  return {
    id: w.id,
    status: statusMap[w.status] ?? "running",
    agents: w.agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      currentTask: a.currentTask,
    })),
    error: w.error,
    createdAt: w.createdAt,
    issueId: w.linearUrl.split("/").pop(),
  };
}

// ---------------------------------------------------------------------------
// WorkflowDrawer
// ---------------------------------------------------------------------------

/**
 * Slide-out panel that lists all workflows and expands each into a ProgressPanel.
 * Uses a custom drawer (fixed panel + backdrop) styled consistently with the AM
 * zinc/indigo/emerald palette.
 */
export function WorkflowDrawer({ open, onClose, onStartNew, authFetch, toast }: WorkflowDrawerProps) {
  const [workflows, setWorkflows] = useState<LinearWorkflow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Poll workflows while drawer is mounted
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await authFetch("/api/workflows");
        if (res.ok && !cancelled) {
          const data: LinearWorkflow[] = await res.json();
          setWorkflows(data);
        }
      } catch {
        // silent — network transient
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authFetch]);

  // Auto-expand newest active workflow when none is already expanded
  useEffect(() => {
    if (expandedId) return;
    const active = workflows.find((w) => w.status === "starting" || w.status === "running");
    if (active) setExpandedId(active.id);
  }, [workflows, expandedId]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleCancel = useCallback(
    async (id: string) => {
      try {
        const res = await authFetch(`/api/workflows/${id}`, { method: "DELETE" });
        if (res.ok) {
          setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, status: "cancelled" as const } : w)));
          toast("Workflow cancelled", "info");
        }
      } catch {
        toast("Failed to cancel workflow", "error");
      }
    },
    [authFetch, toast],
  );

  const activeCount = workflows.filter((w) => w.status === "starting" || w.status === "running").length;

  return (
    <>
      {/* Backdrop */}
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
        />
      )}

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="complementary"
        aria-label="Workflow progress"
        className={cn(
          "fixed right-0 top-0 bottom-0 z-50 w-96 max-w-[90vw]",
          "bg-zinc-950 border-l border-zinc-800 shadow-2xl",
          "transition-transform duration-300 ease-in-out flex flex-col",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">Workflows</h2>
            {activeCount > 0 && (
              <Badge variant="info" className="text-[10px]">
                {activeCount} active
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onStartNew}
              className="text-indigo-400 hover:text-indigo-300"
            >
              + New
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              aria-label="Close workflows drawer"
              className="text-zinc-400 hover:text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </Button>
          </div>
        </div>

        {/* Workflow list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {workflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <p className="text-sm text-zinc-500 mb-1">No workflows yet</p>
              <p className="text-xs text-zinc-600">Start a workflow from a Linear issue, project, or cycle.</p>
              <Button type="button" variant="default" size="sm" onClick={onStartNew} className="mt-4">
                Start workflow
              </Button>
            </div>
          ) : (
            workflows.map((wf) => {
              const isExpanded = expandedId === wf.id;
              const isActive = wf.status === "starting" || wf.status === "running";
              const issueLabel = wf.linearUrl.split("/").pop() || wf.id.slice(0, 8);

              return (
                <div key={wf.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  {/* Collapsed header — always visible */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : wf.id)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isActive && <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" />}
                      {wf.status === "completed" && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      )}
                      {wf.status === "failed" && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                      {wf.status === "cancelled" && <span className="w-2 h-2 rounded-full bg-zinc-600 flex-shrink-0" />}
                      <span className="text-xs font-mono text-zinc-300 truncate">{issueLabel}</span>
                      <span className="text-[10px] text-zinc-600">{wf.repository}</span>
                    </div>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                      className={cn("text-zinc-500 transition-transform flex-shrink-0", isExpanded && "rotate-180")}
                    >
                      <path
                        d="M3 4.5l3 3 3-3"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-zinc-800/60">
                      <div className="pt-3">
                        <ProgressPanel workflow={toPanel(wf)} onCancel={() => handleCancel(wf.id)} />
                        {wf.prUrl && (
                          <a
                            href={wf.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 block text-xs text-indigo-400 hover:text-indigo-300 transition-colors truncate"
                          >
                            {wf.prUrl}
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
