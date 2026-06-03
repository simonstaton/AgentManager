"use client";

import { useMemo, useState } from "react";
import type { PullRequestItem } from "../../api";
import { Header } from "../../components/Header";
import { Sidebar } from "../../components/Sidebar";
import { useAgentPolling } from "../../hooks/useAgentPolling";
import { usePRPolling } from "../../hooks/usePRPolling";
import { useKillSwitchContext } from "../../killSwitch";
import { PRResultCard } from "./PRResultCard";

type StateFilter = "all" | "open" | "draft";
type ChecksFilter = "all" | "passing" | "failing" | "pending";

export function PullRequestsView() {
  const { agents } = useAgentPolling();
  const killSwitch = useKillSwitchContext();
  const { pullRequests, isLoading, error, refresh } = usePRPolling();
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [checksFilter, setChecksFilter] = useState<ChecksFilter>("all");
  const [repoFilter, setRepoFilter] = useState("all");

  const repos = useMemo(() => [...new Set(pullRequests.map((pr) => pr.repo))], [pullRequests]);

  const filtered = useMemo(() => {
    return pullRequests.filter((pr: PullRequestItem) => {
      if (stateFilter === "open" && pr.state !== "open") return false;
      if (stateFilter === "draft" && pr.state !== "draft") return false;
      if (checksFilter !== "all" && pr.checksStatus !== checksFilter) return false;
      if (repoFilter !== "all" && pr.repo !== repoFilter) return false;
      return true;
    });
  }, [pullRequests, stateFilter, checksFilter, repoFilter]);

  const counts = useMemo(
    () => ({
      all: pullRequests.length,
      open: pullRequests.filter((pr: PullRequestItem) => pr.state === "open").length,
      draft: pullRequests.filter((pr: PullRequestItem) => pr.state === "draft").length,
      withAgent: pullRequests.filter((pr: PullRequestItem) => pr.agent !== null).length,
    }),
    [pullRequests],
  );

  return (
    <div className="h-screen flex flex-col">
      <Header agentCount={agents.length} killSwitch={killSwitch} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar agents={agents} activeId={null} />
        <main id="main-content" className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-5">
          {/* Page header */}
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <h1 className="text-lg font-semibold text-zinc-100">Pull Requests</h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                {pullRequests.length} PR
                {pullRequests.length !== 1 ? "s" : ""} across {repos.length} repo
                {repos.length !== 1 ? "s" : ""}
                {counts.withAgent > 0 && (
                  <span>
                    {" "}
                    &middot; <span className="text-blue-400/70">{counts.withAgent} agent-owned</span>
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Refresh pull requests"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 12 12"
                fill="none"
                className={isLoading ? "animate-spin" : ""}
                aria-hidden="true"
              >
                <path
                  d="M10 6a4 4 0 1 1-1.27-2.9M10 2v3H7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Refresh
            </button>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded-md bg-amber-950/40 border border-amber-800/50 text-xs text-amber-300">
              {error}
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-1 bg-zinc-900/50 border border-zinc-800 rounded-md p-0.5">
              {(["all", "open", "draft"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStateFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                    stateFilter === f ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {f === "all"
                    ? `All (${counts.all})`
                    : f === "open"
                      ? `Open (${counts.open})`
                      : `Draft (${counts.draft})`}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-zinc-900/50 border border-zinc-800 rounded-md p-0.5">
              {(["all", "passing", "failing", "pending"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setChecksFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                    checksFilter === f ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {f === "all" ? "All checks" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {repos.length > 1 && (
              <select
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                className="bg-zinc-900/50 border border-zinc-800 rounded-md px-2.5 py-1 text-[11px] text-zinc-400 focus:outline-none focus:border-zinc-600"
              >
                <option value="all">All repos</option>
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Loading skeleton */}
          {isLoading && pullRequests.length === 0 && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 animate-pulse">
                  <div className="h-3 w-48 bg-zinc-800 rounded mb-3" />
                  <div className="h-4 w-96 bg-zinc-800 rounded mb-3" />
                  <div className="h-2 w-64 bg-zinc-800/60 rounded" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && pullRequests.length === 0 && !error && (
            <div className="text-center py-16">
              <svg
                width="48"
                height="48"
                viewBox="0 0 48 48"
                fill="none"
                className="mx-auto mb-4 text-zinc-700"
                aria-hidden="true"
              >
                <path
                  d="M20 8a8 8 0 0 0-4 14.93v10.14a8 8 0 1 0 4 0V22.93A8 8 0 0 0 20 8ZM32 8a8 8 0 0 1 4 14.93v2.14a8 8 0 0 1-8 8h-2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <p className="text-sm text-zinc-500">No pull requests found</p>
              <p className="text-xs text-zinc-600 mt-1">PRs will appear here when agents create them</p>
            </div>
          )}

          {/* Filtered empty */}
          {!isLoading && pullRequests.length > 0 && filtered.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-zinc-500">No PRs match the current filters</p>
            </div>
          )}

          {/* PR list */}
          <div className="space-y-2">
            {filtered.map((pr: PullRequestItem) => (
              <PRResultCard key={`${pr.repo}-${pr.number}`} pr={pr} />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
