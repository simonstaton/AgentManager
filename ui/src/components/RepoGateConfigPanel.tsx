"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfidenceLabel, createApi, RepoGateConfig, RepoGateConfigResponse } from "../api";

const CONFIDENCE_LEVELS: ConfidenceLabel[] = ["high", "medium", "low", "critical"];

interface RepoGateConfigPanelProps {
  api: ReturnType<typeof createApi>;
  repoName: string;
}

export function RepoGateConfigPanel({ api, repoName }: RepoGateConfigPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<RepoGateConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editable state — mirrors effective config
  const [threshold, setThreshold] = useState<ConfidenceLabel>("high");
  const [maxLines, setMaxLines] = useState(400);
  const [maxFiles, setMaxFiles] = useState(20);
  const [mergePolicyAllowed, setMergePolicyAllowed] = useState<Record<ConfidenceLabel, boolean>>({
    high: true,
    medium: false,
    low: false,
    critical: false,
  });

  useEffect(
    () => () => {
      if (messageTimeoutRef.current != null) clearTimeout(messageTimeoutRef.current);
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getRepoGateConfig(repoName);
      setData(result);
      const eff = result.effective;
      setThreshold(eff.autoMergeThreshold);
      setMaxLines(eff.prSize.maxLines);
      setMaxFiles(eff.prSize.maxFiles);
      setMergePolicyAllowed({
        high: eff.mergePolicy.high.allowed,
        medium: eff.mergePolicy.medium.allowed,
        low: eff.mergePolicy.low.allowed,
        critical: eff.mergePolicy.critical.allowed,
      });
    } catch (err) {
      console.error("[RepoGateConfigPanel] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [api, repoName]);

  useEffect(() => {
    if (expanded && !data) {
      load();
    }
  }, [expanded, data, load]);

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
    if (!data) return;
    setSaving(true);
    try {
      const overrides: Partial<RepoGateConfig> = {
        autoMergeThreshold: threshold,
        prSize: { maxLines, maxFiles, maxConcerns: data.effective.prSize.maxConcerns },
        mergePolicy: {
          high: { allowed: mergePolicyAllowed.high, reason: data.effective.mergePolicy.high.reason },
          medium: { allowed: mergePolicyAllowed.medium, reason: data.effective.mergePolicy.medium.reason },
          low: { allowed: mergePolicyAllowed.low, reason: data.effective.mergePolicy.low.reason },
          critical: { allowed: mergePolicyAllowed.critical, reason: data.effective.mergePolicy.critical.reason },
        },
      };
      const result = await api.updateRepoGateConfig(repoName, overrides);
      setData(result);
      showMessage("Gate config saved", "success");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const result = await api.resetRepoGateConfig(repoName);
      setData(result);
      const eff = result.effective;
      setThreshold(eff.autoMergeThreshold);
      setMaxLines(eff.prSize.maxLines);
      setMaxFiles(eff.prSize.maxFiles);
      setMergePolicyAllowed({
        high: eff.mergePolicy.high.allowed,
        medium: eff.mergePolicy.medium.allowed,
        low: eff.mergePolicy.low.allowed,
        critical: eff.mergePolicy.critical.allowed,
      });
      showMessage("Reset to defaults", "success");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to reset", "error");
    } finally {
      setSaving(false);
    }
  };

  const hasOverrides =
    data &&
    (data.overrides.autoMergeThreshold !== undefined ||
      data.overrides.prSize !== undefined ||
      data.overrides.mergePolicy !== undefined);

  return (
    <div className="border border-zinc-800 rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">Gate Config</span>
          {hasOverrides && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-900/50 text-amber-400">
              customized
            </span>
          )}
        </div>
        <svg
          aria-hidden="true"
          className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-5 border-t border-zinc-800">
          {loading && <p className="text-xs text-zinc-400 pt-3">Loading gate config...</p>}

          {!loading && data && (
            <>
              {/* Auto-merge threshold */}
              <div className="pt-3 space-y-2">
                <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Auto-merge Threshold
                </Label>
                <p className="text-xs text-zinc-500">
                  Minimum confidence level required for agent auto-merge via merge-gate.
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {CONFIDENCE_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setThreshold(level)}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        threshold === level
                          ? "bg-zinc-200 text-zinc-900"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* Merge policy toggles */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Merge Policy</Label>
                <p className="text-xs text-zinc-500">Which confidence levels allow auto-merge.</p>
                <div className="space-y-1.5">
                  {CONFIDENCE_LEVELS.map((level) => (
                    <div key={level} className="flex items-center justify-between py-1">
                      <span className="text-sm text-zinc-300 capitalize">{level}</span>
                      <button
                        type="button"
                        onClick={() => setMergePolicyAllowed((prev) => ({ ...prev, [level]: !prev[level] }))}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                          mergePolicyAllowed[level] ? "bg-zinc-300" : "bg-zinc-700"
                        }`}
                        role="switch"
                        aria-checked={mergePolicyAllowed[level]}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-zinc-900 transition-transform ${
                            mergePolicyAllowed[level] ? "translate-x-4" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* PR size limits */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">PR Size Limits</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`max-lines-${repoName}`} className="text-xs text-zinc-400">
                      Max Lines
                    </Label>
                    <Input
                      id={`max-lines-${repoName}`}
                      type="number"
                      value={maxLines}
                      onChange={(e) => setMaxLines(Number(e.target.value))}
                      min={50}
                      max={800}
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`max-files-${repoName}`} className="text-xs text-zinc-400">
                      Max Files
                    </Label>
                    <Input
                      id={`max-files-${repoName}`}
                      type="number"
                      value={maxFiles}
                      onChange={(e) => setMaxFiles(Number(e.target.value))}
                      min={5}
                      max={50}
                      className="h-8"
                    />
                  </div>
                </div>
              </div>

              {/* Audit info */}
              {data.updatedAt && (
                <p className="text-[11px] text-zinc-500">
                  Last updated: {new Date(data.updatedAt).toLocaleString()}
                  {data.updatedBy ? ` by ${data.updatedBy}` : ""}
                </p>
              )}

              {message && <Alert variant={messageType === "error" ? "destructive" : "default"}>{message}</Alert>}

              <div className="flex gap-2 pt-1">
                <Button variant="default" size="sm" onClick={save} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
                {hasOverrides && (
                  <Button variant="secondary" size="sm" onClick={reset} disabled={saving}>
                    Reset to defaults
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
