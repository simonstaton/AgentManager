"use client";

interface TokenUsageBarProps {
  /** Current value (e.g. tokens used, cost spent) */
  current: number;
  /** Maximum limit value */
  limit: number;
  /** Format function for the label text */
  formatValue?: (value: number) => string;
  /** Label shown on the left (defaults to none) */
  label?: string;
  /** Display size (defaults to sm) */
  size?: "sm" | "md";
}

/** Threshold percentages for colour transitions */
const WARN_PCT = 70;
const DANGER_PCT = 90;

function getBarColor(pct: number): string {
  if (pct >= DANGER_PCT) return "bg-red-500";
  if (pct >= WARN_PCT) return "bg-amber-500";
  return "bg-emerald-500";
}

export function TokenUsageBar({ current, limit, formatValue, label, size = "sm" }: TokenUsageBarProps) {
  if (limit <= 0) return null;

  const pct = Math.min(100, (current / limit) * 100);
  const heightClass = size === "md" ? "h-2" : "h-1.5";
  const fmt = formatValue ?? String;

  return (
    <div className="w-full">
      {(label || formatValue) && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-[10px] text-zinc-500">{label}</span>}
          <span className="text-[10px] text-zinc-400 ml-auto">
            {fmt(current)} / {fmt(limit)}
          </span>
        </div>
      )}
      <div className={`w-full ${heightClass} bg-zinc-700/50 rounded-full overflow-hidden`}>
        <div
          className={`${heightClass} rounded-full transition-all duration-500 ${getBarColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
