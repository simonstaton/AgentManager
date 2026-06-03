export interface AgentCostData {
  model: string;
  estimatedCost: number;
  apiTurns: number;
}

export interface AnomalyResult {
  anomalyLevel: "none" | "warning" | "critical";
  anomalyReason: string | null;
}

export function detectCostAnomalies(agents: AgentCostData[]): Map<number, AnomalyResult> {
  const result = new Map<number, AnomalyResult>();
  const cptByModel = new Map<string, number[]>();
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (agent.apiTurns >= 2) {
      const cpt = agent.estimatedCost / agent.apiTurns;
      if (!cptByModel.has(agent.model)) cptByModel.set(agent.model, []);
      cptByModel.get(agent.model)?.push(cpt);
    }
  }
  const medianByModel = new Map<string, number>();
  for (const [model, costs] of cptByModel) {
    const sorted = [...costs].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + sorted[mid]) / 2;
    medianByModel.set(model, median);
  }
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    let anomalyLevel: "none" | "warning" | "critical" = "none";
    let anomalyReason: string | null = null;
    const median = medianByModel.get(agent.model);
    if (median != null && median > 0 && agent.apiTurns >= 2) {
      const ratio = agent.estimatedCost / agent.apiTurns / median;
      if (ratio >= 4) {
        anomalyLevel = "critical";
        anomalyReason = `Cost per turn is ${ratio.toFixed(1)}x higher than median for ${agent.model} agents`;
      } else if (ratio >= 2) {
        anomalyLevel = "warning";
        anomalyReason = `Cost per turn is ${ratio.toFixed(1)}x higher than median for ${agent.model} agents`;
      }
    }
    result.set(i, { anomalyLevel, anomalyReason });
  }
  return result;
}
