import type { CostTracker } from "./cost-tracker";
import { logger } from "./logger";
import { type AllowedModel, MODELS } from "./models";
import { saveAgentState } from "./persistence";
import type { AgentProcess, AgentUsage } from "./types";

/** Minimal registry interface for reading agent data.
 *  `Map<string, AgentProcess>` satisfies this structurally. */
export interface AgentRegistry {
  get(id: string): AgentProcess | undefined;
  values(): IterableIterator<AgentProcess>;
}

/** Context window limit per model, derived from the MODELS registry. */
export const TOKEN_LIMITS: Record<string, number> = Object.fromEntries(
  Object.entries(MODELS).map(([id, m]) => [id, m.tokenLimit]),
);

/** Per-million-token pricing by model, derived from the MODELS registry. */
export const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> =
  Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, m.pricing]));

export const PRICING_LAST_VERIFIED = "2026-06-01";
export const PRICING_STALENESS_DAYS = 90;

/** Module-level flag to warn at most once per process lifetime. */
let pricingStalenessWarned = false;

/** Set of model IDs we have already logged as missing from MODEL_PRICING. */
const unknownModelsWarned = new Set<string>();

/** Estimate cost in USD from token usage and model pricing. */
export function estimateCost(
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
): number {
  if (!pricingStalenessWarned) {
    const age = (Date.now() - new Date(PRICING_LAST_VERIFIED).getTime()) / 86_400_000;
    if (age > PRICING_STALENESS_DAYS) {
      logger.warn(
        `[cost] MODEL_PRICING last verified ${PRICING_LAST_VERIFIED} (${Math.round(age)}d ago). ` +
          "Check https://www.anthropic.com/pricing for updates.",
      );
      pricingStalenessWarned = true;
    }
  }
  const pricing = MODELS[model as AllowedModel]?.pricing;
  if (!pricing) {
    if (model && !unknownModelsWarned.has(model)) {
      unknownModelsWarned.add(model);
      logger.warn(`[cost] No pricing entry for "${model}" — costs will report $0 for this model.`);
    }
    return 0;
  }
  const perM = 1_000_000;
  return (
    ((usage.input_tokens ?? 0) / perM) * pricing.input +
    ((usage.output_tokens ?? 0) / perM) * pricing.output +
    ((usage.cache_read_input_tokens ?? 0) / perM) * pricing.cacheRead +
    ((usage.cache_creation_input_tokens ?? 0) / perM) * pricing.cacheWrite
  );
}

/**
 * UsageTracker encapsulates per-agent token accounting and cost persistence.
 */
export class UsageTracker {
  constructor(
    private registry: AgentRegistry,
    private costTracker: CostTracker | null,
  ) {}

  /** Return token usage and estimated cost for a single agent. */
  getUsage(id: string): AgentUsage | null {
    const agentProc = this.registry.get(id);
    if (!agentProc) return null;
    const { agent } = agentProc;
    const tokensIn = agent.usage?.tokensIn ?? 0;
    const tokensOut = agent.usage?.tokensOut ?? 0;
    const tokensTotal = tokensIn + tokensOut;
    const tokenLimit = MODELS[agent.model as AllowedModel]?.tokenLimit ?? 200_000;
    const lastTurnTokensIn = agent.usage?.lastTurnTokensIn ?? 0;
    return {
      tokensIn,
      tokensOut,
      tokensTotal,
      tokenLimit,
      tokensRemaining: Math.max(0, tokenLimit - lastTurnTokensIn),
      estimatedCost: Math.round((agent.usage?.estimatedCost ?? 0) * 1e6) / 1e6,
      model: agent.model,
      sessionStart: agent.createdAt,
      lastTurnTokensIn,
    };
  }

  /** Return token usage for all agents. */
  getAllUsage(): { agents: Array<{ id: string; name: string; usage: AgentUsage }> } {
    const result: Array<{ id: string; name: string; usage: AgentUsage }> = [];
    for (const agentProc of this.registry.values()) {
      const usage = this.getUsage(agentProc.agent.id);
      if (usage) {
        result.push({ id: agentProc.agent.id, name: agentProc.agent.name, usage });
      }
    }
    return { agents: result };
  }

  /** Reset in-memory usage counters for all tracked agents. */
  resetAllUsage(): void {
    for (const agentProc of this.registry.values()) {
      agentProc.agent.usage = {
        tokensIn: 0,
        tokensOut: 0,
        estimatedCost: 0,
        totalTokensSpent: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        apiTurns: 0,
        lastTurnTokensIn: 0,
      };
      saveAgentState(agentProc.agent);
    }
  }

  /** Persist usage snapshot to SQLite cost tracker. Only called when usage actually changes. */
  upsertCostTracker(agentProc: AgentProcess): void {
    if (!this.costTracker || !agentProc.agent.usage) return;
    const usage = agentProc.agent.usage;
    this.costTracker.upsert({
      agentId: agentProc.agent.id,
      agentName: agentProc.agent.name,
      model: agentProc.agent.model,
      tokensIn: usage.totalTokensIn ?? usage.tokensIn,
      tokensOut: usage.totalTokensOut ?? usage.tokensOut,
      estimatedCost: usage.estimatedCost,
      createdAt: agentProc.agent.createdAt,
    });
  }
}
