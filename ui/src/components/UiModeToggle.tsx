"use client";

import type { KeyboardEvent } from "react";
import type { UiMode } from "../hooks/useUiMode";
import { useUiMode } from "../hooks/useUiMode";

export const MODES: { key: UiMode; label: string; hint: string }[] = [
  { key: "basic", label: "Basic", hint: "Simplified view" },
  { key: "advanced", label: "Advanced", hint: "Full agent controls" },
];

/**
 * Toggle between Basic and Advanced UI modes.
 * Selection is persisted via the useUiMode hook.
 */
export function UiModeToggle() {
  const { mode, setMode } = useUiMode();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setMode(mode === "basic" ? "advanced" : "basic");
    }
  };

  return (
    <div
      role="group"
      aria-label="Interface mode"
      onKeyDown={onKeyDown}
      className="flex items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5"
    >
      {MODES.map((m) => {
        const active = mode === m.key;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            aria-pressed={active}
            title={m.hint}
            className={[
              "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
