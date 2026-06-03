"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ContextPolicy, ContextPolicyResponse, createApi } from "../api";

interface ContextPolicyPanelProps {
  api: ReturnType<typeof createApi>;
  /** If provided, shows per-agent policy UI (agent detail view). */
  agentId?: string;
  /** Compact layout for agent detail sidebar. */
  compact?: boolean;
}

export function ContextPolicyPanel({ api, agentId, compact = false }: ContextPolicyPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<ContextPolicyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editable fields
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState(0.72);
  const [cooldownTurns, setCooldownTurns] = useState(3);

  useEffect(
    () => () => {
      if (messageTimeoutRef.current != null) clearTimeout(messageTimeoutRef.current);
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = agentId ? await api.getAgentContextPolicy(agentId) : await api.getContextPolicy();
      setData(result);
      const eff = result.effective.autoReset;
      setEnabled(eff.enabled);
      setThreshold(eff.threshold);
      setCooldownTurns(eff.cooldownTurns);
    } catch (err) {
      console.error("[ContextPolicyPanel] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [api, agentId]);

  useEffect(() => {
    if (compact) {
      // In compact mode (agent detail), load immediately when rendered
      if (!data) load();
    } else if (expanded && !data) {
      load();
    }
  }, [compact, expanded, data, load]);

  const showMessage = (msg: string, type: "success" | "error") => {
    setMessage(msg);
    setMessageType(type);
    if (messageTimeoutRef.current != null) clearTimeout(messageTimeoutRef.current);
    messageTimeoutRef.current = setTimeout(() => {
      messageTimeoutRef.current = null;
      setMessage("");
    }, 4000);
  };

  const save = async () => {
    setSaving(true);
    const patch: ContextPolicy = {
      autoReset: { enabled, threshold, cooldownTurns },
    };
    try {
      const result = agentId
        ? await api.updateAgentContextPolicy(agentId, patch)
        : await api.updateContextPolicy(patch);
      setData(result);
      const eff = result.effective.autoReset;
      setEnabled(eff.enabled);
      setThreshold(eff.threshold);
      setCooldownTurns(eff.cooldownTurns);
      showMessage("Policy saved", "success");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!agentId) return;
    setSaving(true);
    try {
      const result = await api.resetAgentContextPolicy(agentId);
      setData(result);
      const eff = result.effective.autoReset;
      setEnabled(eff.enabled);
      setThreshold(eff.threshold);
      setCooldownTurns(eff.cooldownTurns);
      showMessage("Reset to global default", "success");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to reset", "error");
    } finally {
      setSaving(false);
    }
  };

  const hasAgentOverride = agentId && data?.agent && data.agent.updatedAt !== "";

  const bounds = data?.bounds.autoReset ?? {
    threshold: { min: 0.5, max: 0.9 },
    cooldownTurns: { min: 1, max: 50 },
  };

  // Compact layout used in agent detail sidebar
  if (compact) {
    return (
      <div className="border-b border-zinc-800">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <span>Context Policy</span>
            {hasAgentOverride && (
              <span className="px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-900/50 text-amber-400">
                override
              </span>
            )}
          </div>
          <svg
            aria-hidden="true"
            className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {expanded && (
          <div className="px-4 pb-3 space-y-3">
            {loading && <p className="text-xs text-zinc-500">Loading...</p>}
            {!loading && data && (
              <>
                <div className="flex items-center justify-between py-0.5">
                  <span className="text-xs text-zinc-400">Auto-reset</span>
                  <button
                    type="button"
                    onClick={() => setEnabled((v) => !v)}
                    className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
                      enabled ? "bg-zinc-300" : "bg-zinc-700"
                    }`}
                    role="switch"
                    aria-checked={enabled}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-zinc-900 transition-transform ${
                        enabled ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-xs text-zinc-400">
                      Threshold <span className="text-zinc-500">({Math.round(threshold * 100)}%)</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={bounds.threshold.min}
                    max={bounds.threshold.max}
                    step={0.01}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    disabled={!enabled}
                    className="w-full h-1.5 accent-zinc-300 disabled:opacity-40"
                  />
                </div>

                <div className="flex items-center justify-between py-0.5">
                  <span className="text-xs text-zinc-400">Cooldown turns</span>
                  <Input
                    type="number"
                    value={cooldownTurns}
                    onChange={(e) => setCooldownTurns(Number(e.target.value))}
                    min={bounds.cooldownTurns.min}
                    max={bounds.cooldownTurns.max}
                    disabled={!enabled}
                    className="h-6 w-16 text-xs"
                  />
                </div>

                {message && (
                  <Alert variant={messageType === "error" ? "destructive" : "default"} className="py-2 text-xs">
                    {message}
                  </Alert>
                )}

                <div className="flex gap-1.5">
                  <Button variant="default" size="xs" onClick={save} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  {hasAgentOverride && (
                    <Button variant="secondary" size="xs" onClick={reset} disabled={saving}>
                      Reset
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // Full layout for settings/context page
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Context Auto-Reset Policy</p>
        <p className="text-xs text-zinc-400">
          Configure when agents automatically compact their context window. Applies globally; per-agent overrides are
          available from the agent detail panel.
        </p>
      </div>

      {loading && (
        <div className="space-y-3">
          <div className="h-8 rounded bg-zinc-800 animate-pulse" />
          <div className="h-8 rounded bg-zinc-800 animate-pulse" />
          <div className="h-8 rounded bg-zinc-800 animate-pulse" />
        </div>
      )}

      {!loading && data && (
        <div className="space-y-5 max-w-md">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-zinc-200">Enable auto-reset</Label>
              <p className="text-xs text-zinc-500 mt-0.5">
                Automatically compact agent context when the window fills up.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                enabled ? "bg-zinc-300" : "bg-zinc-700"
              }`}
              role="switch"
              aria-checked={enabled}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-zinc-900 transition-transform ${
                  enabled ? "translate-x-4" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Threshold slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="ctx-threshold" className="text-sm text-zinc-200">
                Reset threshold
              </Label>
              <span className="text-xs text-zinc-400">{Math.round(threshold * 100)}%</span>
            </div>
            <p className="text-xs text-zinc-500">
              Context utilisation at which an auto-reset is triggered ({bounds.threshold.min * 100}–
              {bounds.threshold.max * 100}%).
            </p>
            <input
              id="ctx-threshold"
              type="range"
              min={bounds.threshold.min}
              max={bounds.threshold.max}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={!enabled}
              className="w-full h-2 accent-zinc-300 disabled:opacity-40"
            />
          </div>

          {/* Cooldown turns */}
          <div className="space-y-1.5">
            <Label htmlFor="ctx-cooldown" className="text-sm text-zinc-200">
              Cooldown turns
            </Label>
            <p className="text-xs text-zinc-500">
              Idle turns to wait after a reset before triggering another ({bounds.cooldownTurns.min}–
              {bounds.cooldownTurns.max}).
            </p>
            <Input
              id="ctx-cooldown"
              type="number"
              value={cooldownTurns}
              onChange={(e) => setCooldownTurns(Number(e.target.value))}
              min={bounds.cooldownTurns.min}
              max={bounds.cooldownTurns.max}
              disabled={!enabled}
              className="h-9 w-28"
            />
          </div>

          {/* Audit info */}
          {data.global.updatedAt && (
            <p className="text-[11px] text-zinc-500">
              Last updated: {new Date(data.global.updatedAt).toLocaleString()}
            </p>
          )}

          {message && <Alert variant={messageType === "error" ? "destructive" : "default"}>{message}</Alert>}

          <div className="flex gap-2">
            <Button variant="default" size="default" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
