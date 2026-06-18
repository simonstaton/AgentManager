"use client";

import { formatCost } from "../utils/format";

interface BudgetGaugeProps {
  /** Current spend in USD */
  spent: number;
  /** Budget cap in USD. When falsy, renders a 'No limit' indicator. */
  budgetUsd?: number;
  /** Display size: compact inline (sm, default) or larger detail panel (md) */
  size?: "sm" | "md";
}

/** Percentage thresholds for colour transitions */
const WARN_PCT = 75;
const DANGER_PCT = 90;

function getBarColor(pct: number): string {
  if (pct >= DANGER_PCT) return "bg-red-500";
  if (pct >= WARN_PCT) return "bg-amber-500";
  return "bg-emerald-500";
}

function getLabelColor(pct: number): string {
  if (pct >= DANGER_PCT) return "text-red-400";
  if (pct >= WARN_PCT) return "text-amber-400";
  return "text-zinc-400";
}

export function BudgetGauge({ spent, budgetUsd, size = "sm" }: BudgetGaugeProps) {
  const heightClass = size === "md" ? "h-2" : "h-1.5";

  if (!budgetUsd) {
    return (
      <div className="flex items-center justify-between">
        {size === "md" && <span className="text-[10px] text-zinc-500">Budget</span>}
        <span className="text-[10px] text-zinc-500 ml-auto">No limit</span>
      </div>
    );
  }

  // Defensively clamp `spent` at zero: a transiently-negative cost from a
  // backend reconciliation race must not render a negative bar width or %.
  const safeSpent = Number.isFinite(spent) && spent > 0 ? spent : 0;
  const pct = Math.max(0, Math.min(100, (safeSpent / budgetUsd) * 100));
  const label = `${formatCost(safeSpent)} / ${formatCost(budgetUsd)} (${Math.round(pct)}%)`;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        {size === "md" && <span className="text-[10px] text-zinc-500">Budget</span>}
        <span className={`text-[10px] ml-auto ${getLabelColor(pct)}`}>{label}</span>
      </div>
      <div className={`w-full ${heightClass} bg-zinc-700/50 rounded-full overflow-hidden`}>
        <div
          className={`${heightClass} rounded-full transition-all duration-500 ${getBarColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
