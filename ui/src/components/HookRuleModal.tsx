"use client";

import { useCallback, useEffect, useRef } from "react";
import type { HookEvent, HookRule, HookType } from "../api";

export const HOOK_EVENTS: HookEvent[] = ["PreToolUse", "PostToolUse", "Stop", "SubagentStart", "SubagentStop"];
export const HOOK_TYPES: HookType[] = ["http", "command"];
export const MATCHER_EVENTS = new Set<HookEvent>(["PreToolUse", "PostToolUse"]);

export type FormState = {
  event: HookEvent;
  type: HookType;
  matcher: string;
  url: string;
  command: string;
  timeout: string;
  async: boolean;
};

export const DEFAULT_FORM: FormState = {
  event: "PreToolUse",
  type: "http",
  matcher: "",
  url: "",
  command: "",
  timeout: "5000",
  async: false,
};

export function formFromRule(rule: HookRule): FormState {
  return {
    event: rule.event,
    type: rule.type,
    matcher: rule.matcher ?? "",
    url: rule.url ?? "",
    command: rule.command ?? "",
    timeout: String(rule.timeout ?? 5000),
    async: rule.async ?? false,
  };
}

export function ruleFromForm(form: FormState, id: string): HookRule {
  const rule: HookRule = { id, event: form.event, type: form.type };
  if (MATCHER_EVENTS.has(form.event) && form.matcher.trim()) {
    rule.matcher = form.matcher.trim();
  }
  if (form.type === "http" && form.url.trim()) {
    rule.url = form.url.trim();
  }
  if (form.type === "command" && form.command.trim()) {
    rule.command = form.command.trim();
  }
  const timeout = Number(form.timeout);
  if (!Number.isNaN(timeout) && timeout > 0) {
    rule.timeout = timeout;
  }
  rule.async = form.async;
  return rule;
}

export function generateId(): string {
  return `hook-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function Spinner() {
  return (
    <div
      className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin"
      role="status"
      aria-label="Loading"
    />
  );
}

export interface HookRuleModalProps {
  editingRule: HookRule | null;
  form: FormState;
  saving: boolean;
  onFormChange: (patch: Partial<FormState>) => void;
  onSave: () => void;
  onClose: () => void;
}

/**
 * Modal dialog for adding or editing a hook rule.
 * Uses a custom backdrop overlay (consistent with ConfirmDialog in this codebase).
 */
export function HookRuleModal({ editingRule, form, saving, onFormChange, onSave, onClose }: HookRuleModalProps) {
  const firstInputRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop intentionally handles click-outside-to-close
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editingRule ? "Edit hook rule" : "Add hook rule"}
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-md mx-4 p-6 space-y-4"
      >
        <h2 className="text-base font-semibold text-zinc-100">{editingRule ? "Edit Hook Rule" : "Add Hook Rule"}</h2>

        {/* Event */}
        <div className="space-y-1">
          <label htmlFor="hook-event" className="text-xs text-zinc-400">
            Event
          </label>
          <select
            id="hook-event"
            ref={firstInputRef}
            value={form.event}
            onChange={(e) => onFormChange({ event: e.target.value as HookEvent })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            {HOOK_EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </select>
        </div>

        {/* Type */}
        <div className="space-y-1">
          <span className="text-xs text-zinc-400">Type</span>
          <div className="flex gap-4">
            {HOOK_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="hook-type"
                  value={t}
                  checked={form.type === t}
                  onChange={() => onFormChange({ type: t })}
                  className="accent-zinc-400"
                />
                <span className="text-sm text-zinc-300">{t}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Matcher (only for tool-use events) */}
        {MATCHER_EVENTS.has(form.event) && (
          <div className="space-y-1">
            <label htmlFor="hook-matcher" className="text-xs text-zinc-400">
              Tool name regex (optional)
            </label>
            <input
              id="hook-matcher"
              type="text"
              value={form.matcher}
              onChange={(e) => onFormChange({ matcher: e.target.value })}
              placeholder="e.g. Bash|Edit"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
        )}

        {/* URL or command */}
        {form.type === "http" ? (
          <div className="space-y-1">
            <label htmlFor="hook-url" className="text-xs text-zinc-400">
              Webhook URL
            </label>
            <input
              id="hook-url"
              type="url"
              value={form.url}
              onChange={(e) => onFormChange({ url: e.target.value })}
              placeholder="https://example.com/hook"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label htmlFor="hook-command" className="text-xs text-zinc-400">
              Shell command
            </label>
            <input
              id="hook-command"
              type="text"
              value={form.command}
              onChange={(e) => onFormChange({ command: e.target.value })}
              placeholder="e.g. /usr/local/bin/audit-hook.sh"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
        )}

        {/* Timeout */}
        <div className="space-y-1">
          <label htmlFor="hook-timeout" className="text-xs text-zinc-400">
            Timeout (ms)
          </label>
          <input
            id="hook-timeout"
            type="number"
            min={1}
            max={60000}
            value={form.timeout}
            onChange={(e) => onFormChange({ timeout: e.target.value })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
        </div>

        {/* Async */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.async}
            onChange={(e) => onFormChange({ async: e.target.checked })}
            className="accent-zinc-400"
          />
          <span className="text-sm text-zinc-300">Fire and forget (async)</span>
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold bg-zinc-600 hover:bg-zinc-500 text-white rounded transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Spinner />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
