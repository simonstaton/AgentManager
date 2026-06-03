"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HookRule } from "../api";
import { useApi } from "../hooks/useApi";
import { DEFAULT_FORM, type FormState, formFromRule, generateId, HookRuleModal, ruleFromForm } from "./HookRuleModal";

interface HooksConfigPanelProps {
  agentId: string;
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

/**
 * Panel for viewing and editing hook rules attached to an agent.
 * Renders inline in the agent detail sidebar (collapsed by default).
 */
export function HooksConfigPanel({ agentId }: HooksConfigPanelProps) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;

  const [expanded, setExpanded] = useState(false);
  const [rules, setRules] = useState<HookRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<HookRule | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch hook rules when the panel is expanded
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiRef.current
      .getHookConfig(agentId)
      .then((fetched) => {
        if (!cancelled) {
          setRules(fetched);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load hook rules");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, expanded]);

  const openAdd = useCallback(() => {
    setEditingRule(null);
    setForm(DEFAULT_FORM);
    setSaveError(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((rule: HookRule) => {
    setEditingRule(rule);
    setForm(formFromRule(rule));
    setSaveError(null);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingRule(null);
  }, []);

  const handleFormChange = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const id = editingRule?.id ?? generateId();
      const updatedRule = ruleFromForm(form, id);
      const updatedRules = editingRule
        ? rules.map((r) => (r.id === editingRule.id ? updatedRule : r))
        : [...rules, updatedRule];
      const saved = await apiRef.current.setHookConfig(agentId, updatedRules);
      setRules(saved);
      setModalOpen(false);
      setEditingRule(null);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save hook rule");
    } finally {
      setSaving(false);
    }
  }, [editingRule, form, rules, agentId]);

  const handleDelete = useCallback(
    async (ruleId: string) => {
      setSaving(true);
      setSaveError(null);
      try {
        const updatedRules = rules.filter((r) => r.id !== ruleId);
        const saved = await apiRef.current.setHookConfig(agentId, updatedRules);
        setRules(saved);
      } catch (err: unknown) {
        setSaveError(err instanceof Error ? err.message : "Failed to delete hook rule");
      } finally {
        setSaving(false);
      }
    },
    [rules, agentId],
  );

  return (
    <div className="border-b border-zinc-800">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          Hook Rules
          {rules.length > 0 && <span className="text-[10px] text-zinc-600">({rules.length})</span>}
        </span>
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
          {/* Add rule button */}
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-zinc-500">Intercept tool calls, completions, and sub-agent events.</p>
            <button
              type="button"
              onClick={openAdd}
              disabled={loading || saving}
              className="px-2.5 py-1 text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors disabled:opacity-50"
            >
              Add Rule
            </button>
          </div>

          {/* Save error */}
          {saveError && (
            <div role="alert" className="px-3 py-2 bg-red-950/30 border border-red-800/50 rounded text-red-300 text-xs">
              {saveError}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 py-4 text-zinc-500">
              <Spinner />
              <span className="text-xs">Loading hook rules…</span>
            </div>
          )}

          {/* Fetch error */}
          {!loading && error && (
            <div role="alert" className="px-3 py-2 bg-red-950/30 border border-red-800/50 rounded text-red-300 text-xs">
              {error}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && rules.length === 0 && (
            <p className="text-xs text-zinc-500 py-2">No hook rules configured.</p>
          )}

          {/* Rules table */}
          {!loading && !error && rules.length > 0 && (
            <div className="overflow-x-auto rounded border border-zinc-800">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/50">
                    <th className="px-2 py-1.5 font-medium text-zinc-400">Event</th>
                    <th className="px-2 py-1.5 font-medium text-zinc-400">Type</th>
                    <th className="px-2 py-1.5 font-medium text-zinc-400">Target</th>
                    <th className="px-2 py-1.5 font-medium text-zinc-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/30">
                      <td className="px-2 py-1.5 text-zinc-300 whitespace-nowrap">{rule.event}</td>
                      <td className="px-2 py-1.5">
                        <span className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono">{rule.type}</span>
                      </td>
                      <td
                        className="px-2 py-1.5 font-mono text-zinc-400 max-w-[140px] truncate"
                        title={rule.url ?? rule.command}
                      >
                        {rule.url ?? rule.command ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(rule)}
                            disabled={saving}
                            className="text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(rule.id)}
                            disabled={saving}
                            className="text-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modalOpen && (
        <HookRuleModal
          editingRule={editingRule}
          form={form}
          saving={saving}
          onFormChange={handleFormChange}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
