"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useApi } from "../hooks/useApi";
import { useKillSwitchContext } from "../killSwitch";

interface AgentCost {
  agentId: string;
  agentName: string;
  tokensUsed: number;
  estimatedCost: number;
  createdAt: string;
  status: string;
}

interface AllTimeTotals {
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalRecords: number;
}

interface CostStats {
  totalTokens: number;
  totalCost: number;
  agentCount: number;
  agents: AgentCost[];
  allTime: AllTimeTotals;
}

interface HistoryRecord {
  agentId: string;
  agentName: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
  createdAt: string;
  closedAt: string | null;
}

export function CostDashboard() {
  const api = useApi();
  const { agents } = useAgentPolling();
  const killSwitch = useKillSwitchContext();
  const [stats, setStats] = useState<CostStats | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [summaryData, historyData] = await Promise.all([api.fetchCostSummary(), api.fetchCostHistory()]);
      setStats(summaryData);
      setHistory(historyData.records);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch cost data";
      setError(message);
      console.error("Cost dashboard error:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleReset = async () => {
    setShowResetConfirm(false);
    try {
      setResetting(true);
      await api.resetCostHistory();
      await fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to reset cost history";
      setError(message);
    } finally {
      setResetting(false);
    }
  };

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(4)}`;
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(2)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(2)}K`;
    return tokens.toString();
  };

  return (
    <div className="h-screen flex flex-col">
      <Header agentCount={agents.length} killSwitch={killSwitch} />
      <ConfirmDialog
        open={showResetConfirm}
        onConfirm={handleReset}
        onCancel={() => setShowResetConfirm(false)}
        title="Reset cost history?"
        description="All historical cost data will be permanently deleted. This cannot be undone."
        confirmLabel="Reset History"
        variant="destructive"
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar agents={agents} activeId={null} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6">
            <h2 className="text-lg font-medium mb-6">Cost & Usage Dashboard</h2>

            {error && (
              <div className="mb-6 p-4 bg-red-950/30 border border-red-800 text-red-300 text-sm rounded-lg">
                {error}
              </div>
            )}

            {loading && !stats ? (
              <div className="space-y-4">
                <div className="h-32 rounded-lg bg-zinc-800/50 animate-pulse" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 rounded-lg bg-zinc-800/50 animate-pulse" />
                  ))}
                </div>
              </div>
            ) : stats ? (
              <>
                {/* Current Session Cards */}
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">Current Session</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-zinc-800/30 border border-zinc-700 rounded-lg p-6">
                    <p className="text-xs font-medium text-zinc-400 uppercase mb-2">Session Cost</p>
                    <p className="text-3xl font-semibold text-zinc-100">{formatCost(stats.totalCost)}</p>
                    <p className="text-xs text-zinc-400 mt-2">Estimated cost</p>
                  </div>

                  <div className="bg-zinc-800/30 border border-zinc-700 rounded-lg p-6">
                    <p className="text-xs font-medium text-zinc-400 uppercase mb-2">Session Tokens</p>
                    <p className="text-3xl font-semibold text-zinc-100">{formatTokens(stats.totalTokens)}</p>
                    <p className="text-xs text-zinc-500 mt-2">Context + output tokens</p>
                  </div>

                  <div className="bg-zinc-800/30 border border-zinc-700 rounded-lg p-6">
                    <p className="text-xs font-medium text-zinc-400 uppercase mb-2">Active Agents</p>
                    <p className="text-3xl font-semibold text-zinc-100">{stats.agentCount}</p>
                    <p className="text-xs text-zinc-400 mt-2">Running agents</p>
                  </div>
                </div>

                {/* All-Time Cards */}
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">All-Time Totals</p>
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(true)}
                    disabled={resetting || stats.allTime.totalRecords === 0}
                    className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-40 disabled:cursor-default transition-colors"
                  >
                    {resetting ? "Resetting..." : "Reset History"}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                  <div className="bg-zinc-800/20 border border-zinc-700/50 rounded-lg p-4">
                    <p className="text-xs font-medium text-zinc-500 uppercase mb-1">Total Cost</p>
                    <p className="text-xl font-semibold text-zinc-200">{formatCost(stats.allTime.totalCost)}</p>
                  </div>
                  <div className="bg-zinc-800/20 border border-zinc-700/50 rounded-lg p-4">
                    <p className="text-xs font-medium text-zinc-500 uppercase mb-1">Tokens In</p>
                    <p className="text-xl font-semibold text-zinc-200">{formatTokens(stats.allTime.totalTokensIn)}</p>
                  </div>
                  <div className="bg-zinc-800/20 border border-zinc-700/50 rounded-lg p-4">
                    <p className="text-xs font-medium text-zinc-500 uppercase mb-1">Tokens Out</p>
                    <p className="text-xl font-semibold text-zinc-200">{formatTokens(stats.allTime.totalTokensOut)}</p>
                  </div>
                  <div className="bg-zinc-800/20 border border-zinc-700/50 rounded-lg p-4">
                    <p className="text-xs font-medium text-zinc-500 uppercase mb-1">Total Agents</p>
                    <p className="text-xl font-semibold text-zinc-200">{stats.allTime.totalRecords}</p>
                  </div>
                </div>

                {/* Current Agents Table */}
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">Active Agents</p>
                <div className="bg-zinc-800/20 border border-zinc-700 rounded-lg overflow-hidden mb-8">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-900/50 border-b border-zinc-700">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-zinc-300">Agent Name</th>
                          <th className="px-4 py-3 text-left font-medium text-zinc-300">Status</th>
                          <th className="px-4 py-3 text-right font-medium text-zinc-300">Tokens</th>
                          <th className="px-4 py-3 text-right font-medium text-zinc-300">Est. Cost</th>
                          <th className="px-4 py-3 text-left font-medium text-zinc-300">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-700">
                        {stats.agents.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                              No active agents
                            </td>
                          </tr>
                        ) : (
                          stats.agents.map((agent) => (
                            <tr key={agent.agentId} className="hover:bg-zinc-800/30 transition-colors">
                              <td className="px-4 py-3 text-zinc-100 font-medium">{agent.agentName}</td>
                              <td className="px-4 py-3">
                                <span className="inline-block px-2 py-1 text-xs font-medium rounded bg-zinc-700/50 text-zinc-300">
                                  {agent.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-zinc-400">{formatTokens(agent.tokensUsed)}</td>
                              <td className="px-4 py-3 text-right text-zinc-400">{formatCost(agent.estimatedCost)}</td>
                              <td className="px-4 py-3 text-zinc-400 text-xs">
                                {new Date(agent.createdAt).toLocaleDateString()}{" "}
                                {new Date(agent.createdAt).toLocaleTimeString()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* History Table */}
                {history.length > 0 && (
                  <>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                      Cost History ({history.length} records)
                    </p>
                    <div className="bg-zinc-800/20 border border-zinc-700 rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-zinc-900/50 border-b border-zinc-700">
                            <tr>
                              <th className="px-4 py-3 text-left font-medium text-zinc-300">Agent</th>
                              <th className="px-4 py-3 text-left font-medium text-zinc-300">Model</th>
                              <th className="px-4 py-3 text-right font-medium text-zinc-300">Tokens In</th>
                              <th className="px-4 py-3 text-right font-medium text-zinc-300">Tokens Out</th>
                              <th className="px-4 py-3 text-right font-medium text-zinc-300">Cost</th>
                              <th className="px-4 py-3 text-left font-medium text-zinc-300">Status</th>
                              <th className="px-4 py-3 text-left font-medium text-zinc-300">Created</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-700">
                            {history.map((record) => (
                              <tr key={record.agentId} className="hover:bg-zinc-800/30 transition-colors">
                                <td className="px-4 py-3 text-zinc-100 font-medium">{record.agentName}</td>
                                <td className="px-4 py-3 text-zinc-400 text-xs">{record.model}</td>
                                <td className="px-4 py-3 text-right text-zinc-400">{formatTokens(record.tokensIn)}</td>
                                <td className="px-4 py-3 text-right text-zinc-400">{formatTokens(record.tokensOut)}</td>
                                <td className="px-4 py-3 text-right text-zinc-400">
                                  {formatCost(record.estimatedCost)}
                                </td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`inline-block px-2 py-1 text-xs font-medium rounded ${record.closedAt ? "bg-zinc-700/50 text-zinc-400" : "bg-green-900/30 text-green-400"}`}
                                  >
                                    {record.closedAt ? "Closed" : "Active"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-zinc-400 text-xs">
                                  {new Date(record.createdAt).toLocaleDateString()}{" "}
                                  {new Date(record.createdAt).toLocaleTimeString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
