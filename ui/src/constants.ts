import type { BadgeVariant } from "@fanvue/ui";

export const STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  running: "success",
  starting: "warning",
  idle: "info",
  error: "error",
  restored: "info",
};

export const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  starting: "Starting",
  idle: "Idle",
  error: "Error",
  restored: "Restored",
};

export function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
