"use client";

import { Badge } from "@/components/ui/badge";
import type { PullRequestItem } from "../../api";
import { timeAgo } from "../../constants";

const CHECKS_META: Record<PullRequestItem["checksStatus"], { colorClass: string; label: string }> = {
  passing: { colorClass: "text-emerald-400", label: "Checks passing" },
  failing: { colorClass: "text-red-400", label: "Checks failing" },
  pending: { colorClass: "text-amber-400", label: "Checks pending" },
  none: { colorClass: "text-zinc-600", label: "No checks" },
};

const REVIEW_BADGE: Record<string, { variant: "success" | "destructive" | "warning"; label: string }> = {
  APPROVED: { variant: "success", label: "Approved" },
  CHANGES_REQUESTED: { variant: "destructive", label: "Changes requested" },
  REVIEW_REQUIRED: { variant: "warning", label: "Review required" },
};

function ChecksIcon({ status }: { status: PullRequestItem["checksStatus"] }) {
  const s = 12;
  switch (status) {
    case "passing":
      return (
        <svg width={s} height={s} viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2.5 6l2.5 2.5 4.5-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "failing":
      return (
        <svg width={s} height={s} viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "pending":
      return (
        <svg width={s} height={s} viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
        </svg>
      );
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="1.5" fill="currentColor" />
        </svg>
      );
  }
}

interface PRResultCardProps {
  pr: PullRequestItem;
}

export function PRResultCard({ pr }: PRResultCardProps) {
  const checksInfo = CHECKS_META[pr.checksStatus];
  const reviewInfo = REVIEW_BADGE[pr.reviewDecision] ?? null;

  const stateVariant = pr.state === "draft" ? "secondary" : pr.state === "merged" ? "info" : "success";
  const stateLabel = pr.state === "draft" ? "Draft" : pr.state === "merged" ? "Merged" : "Open";

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => window.open(pr.url, "_blank", "noopener noreferrer")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") window.open(pr.url, "_blank", "noopener noreferrer");
      }}
      className="block bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 hover:bg-zinc-900/80 transition-colors group cursor-pointer"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-zinc-500">#{pr.number}</span>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-500">{pr.repo}</span>
          </div>
          <h3 className="text-sm font-medium text-zinc-100 group-hover:text-white truncate">{pr.title}</h3>
        </div>
        <Badge variant={stateVariant}>{stateLabel}</Badge>
      </div>

      {/* Branch info */}
      <div className="flex items-center gap-1.5 mb-3">
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          className="text-zinc-600 flex-shrink-0"
          aria-hidden="true"
        >
          <path
            d="M5 3.25a2.25 2.25 0 1 1-1.5 3.93v1.64a2.25 2.25 0 1 0 3 2.12V9.88a2.25 2.25 0 1 1 1.5 0v1.06a3.75 3.75 0 0 1-4.5 3.68V7.18A2.25 2.25 0 0 1 5 3.25Z"
            fill="currentColor"
          />
        </svg>
        <span className="text-[11px] font-mono text-zinc-500 truncate">
          {pr.branch}
          <span className="text-zinc-700"> &rarr; </span>
          {pr.baseBranch}
        </span>
      </div>

      {/* Meta row */}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 text-[11px]">
        {/* CI checks */}
        <span className={`flex items-center gap-1 ${checksInfo.colorClass}`} title={checksInfo.label}>
          <ChecksIcon status={pr.checksStatus} />
          {checksInfo.label}
        </span>

        {/* Review status */}
        {reviewInfo && <Badge variant={reviewInfo.variant}>{reviewInfo.label}</Badge>}

        {/* Diff stats */}
        <span className="text-zinc-500">
          <span className="text-emerald-500">+{pr.additions}</span>
          <span className="text-zinc-700"> / </span>
          <span className="text-red-400">-{pr.deletions}</span>
        </span>

        {/* Author */}
        <span className="text-zinc-500">by {pr.author}</span>

        {/* Updated time */}
        <span className="text-zinc-600">{timeAgo(pr.updatedAt)}</span>

        {/* Labels */}
        {pr.labels.map((label) => (
          <span
            key={label}
            className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50"
          >
            {label}
          </span>
        ))}
      </div>

      {/* Agent attribution */}
      {pr.agent && (
        <div className="mt-3 pt-2.5 border-t border-zinc-800/60">
          <a
            href={`/agents/${pr.agent.id}/`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 text-[11px] text-blue-400/80 hover:text-blue-300 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
            {pr.agent.name}
          </a>
        </div>
      )}
    </div>
  );
}
