import { describe, expect, it } from "vitest";
import { type AgentCostData, detectCostAnomalies } from "./cost-anomaly";

/**
 * Helper: build an AgentCostData with a target cost-per-turn (CPT).
 * estimatedCost = cpt * apiTurns, so the agent's CPT is exactly `cpt`.
 */
function agentWithCpt(model: string, cpt: number, apiTurns = 2): AgentCostData {
  return { model, estimatedCost: cpt * apiTurns, apiTurns };
}

describe("detectCostAnomalies", () => {
  describe("happy path — no anomalies", () => {
    it("returns a result entry for every agent, preserving index order", () => {
      const agents: AgentCostData[] = [agentWithCpt("opus", 1), agentWithCpt("opus", 1), agentWithCpt("opus", 1)];
      const result = detectCostAnomalies(agents);
      expect(result.size).toBe(3);
      expect([...result.keys()]).toEqual([0, 1, 2]);
    });

    it("flags none when all agents have identical cost-per-turn", () => {
      const agents = [agentWithCpt("opus", 5), agentWithCpt("opus", 5), agentWithCpt("opus", 5)];
      const result = detectCostAnomalies(agents);
      for (const r of result.values()) {
        expect(r.anomalyLevel).toBe("none");
        expect(r.anomalyReason).toBeNull();
      }
    });

    it("does not flag CPT just under the 2x warning threshold", () => {
      // Median over [1, 1, 1.9] is 1 → outlier ratio 1.9x < 2 → none.
      const agents = [agentWithCpt("opus", 1), agentWithCpt("opus", 1), agentWithCpt("opus", 1.9)];
      const result = detectCostAnomalies(agents);
      expect(result.get(2)?.anomalyLevel).toBe("none");
    });
  });

  describe("warning threshold (>= 2x, < 4x)", () => {
    it("flags warning at exactly 2x the median", () => {
      // Median of [1, 1, 2] is 1 → the 2-CPT agent is exactly 2x → warning.
      const agents = [agentWithCpt("opus", 1), agentWithCpt("opus", 1), agentWithCpt("opus", 2)];
      const result = detectCostAnomalies(agents);
      expect(result.get(2)?.anomalyLevel).toBe("warning");
      expect(result.get(2)?.anomalyReason).toContain("2.0x");
      expect(result.get(2)?.anomalyReason).toContain("opus");
      // The two baseline agents are at the median → none.
      expect(result.get(0)?.anomalyLevel).toBe("none");
      expect(result.get(1)?.anomalyLevel).toBe("none");
    });

    it("flags warning at 3x and not critical", () => {
      const agents = [agentWithCpt("opus", 1), agentWithCpt("opus", 1), agentWithCpt("opus", 3)];
      const result = detectCostAnomalies(agents);
      expect(result.get(2)?.anomalyLevel).toBe("warning");
      expect(result.get(2)?.anomalyReason).toContain("3.0x");
    });
  });

  describe("critical threshold (>= 4x)", () => {
    it("flags critical at exactly 4x the median", () => {
      const agents = [agentWithCpt("opus", 1), agentWithCpt("opus", 1), agentWithCpt("opus", 4)];
      const result = detectCostAnomalies(agents);
      expect(result.get(2)?.anomalyLevel).toBe("critical");
      expect(result.get(2)?.anomalyReason).toContain("4.0x");
      expect(result.get(2)?.anomalyReason).toContain("opus");
    });

    it("flags critical well above 4x", () => {
      const agents = [agentWithCpt("opus", 1), agentWithCpt("opus", 1), agentWithCpt("opus", 10)];
      const result = detectCostAnomalies(agents);
      expect(result.get(2)?.anomalyLevel).toBe("critical");
      expect(result.get(2)?.anomalyReason).toContain("10.0x");
    });
  });

  describe("per-model isolation", () => {
    it("compares each agent only against its own model's median", () => {
      // opus median = 1; sonnet median = 100. The sonnet agent costs far more in
      // absolute terms but is normal relative to other sonnet agents → none.
      const agents = [
        agentWithCpt("opus", 1),
        agentWithCpt("opus", 1),
        agentWithCpt("sonnet", 100),
        agentWithCpt("sonnet", 100),
      ];
      const result = detectCostAnomalies(agents);
      expect(result.get(2)?.anomalyLevel).toBe("none");
      expect(result.get(3)?.anomalyLevel).toBe("none");
    });

    it("flags an opus outlier without affecting a separate sonnet cohort", () => {
      const agents = [
        agentWithCpt("opus", 1),
        agentWithCpt("opus", 1),
        agentWithCpt("opus", 5), // 5x opus median → critical
        agentWithCpt("sonnet", 10),
        agentWithCpt("sonnet", 10),
      ];
      const result = detectCostAnomalies(agents);
      expect(result.get(2)?.anomalyLevel).toBe("critical");
      expect(result.get(3)?.anomalyLevel).toBe("none");
      expect(result.get(4)?.anomalyLevel).toBe("none");
    });
  });

  describe("minimum-turns guard (apiTurns >= 2)", () => {
    it("never flags an agent with fewer than 2 turns, even if expensive", () => {
      // Baseline cohort establishes a low median; the 1-turn agent has a huge CPT
      // but must be skipped to avoid false positives on brand-new agents.
      const agents = [
        agentWithCpt("opus", 1),
        agentWithCpt("opus", 1),
        { model: "opus", estimatedCost: 1000, apiTurns: 1 },
      ];
      const result = detectCostAnomalies(agents);
      expect(result.get(2)?.anomalyLevel).toBe("none");
      expect(result.get(2)?.anomalyReason).toBeNull();
    });

    it("excludes <2-turn agents from the median calculation", () => {
      // If the 1-turn cheap agent counted, the median would drop and the
      // 2-CPT agent might be flagged. With it excluded, median over the two
      // eligible agents [2, 2] is 2 → the 2-CPT agent is exactly 1x → none.
      const agents = [
        { model: "opus", estimatedCost: 0, apiTurns: 1 }, // excluded
        agentWithCpt("opus", 2),
        agentWithCpt("opus", 2),
      ];
      const result = detectCostAnomalies(agents);
      expect(result.get(1)?.anomalyLevel).toBe("none");
      expect(result.get(2)?.anomalyLevel).toBe("none");
    });
  });

  describe("median computation", () => {
    it("uses the middle value for an odd-sized cohort", () => {
      // CPTs [1, 2, 100] → odd → median = middle of sorted = 2.
      // The 100-CPT agent is 50x median → critical; the 1-CPT agent is 0.5x → none.
      const agents = [agentWithCpt("opus", 1), agentWithCpt("opus", 2), agentWithCpt("opus", 100)];
      const result = detectCostAnomalies(agents);
      expect(result.get(0)?.anomalyLevel).toBe("none");
      expect(result.get(1)?.anomalyLevel).toBe("none");
      expect(result.get(2)?.anomalyLevel).toBe("critical");
    });

    it("averages the two middle values for an even-sized cohort", () => {
      // CPTs [2, 4, 6, 10] sorted → even (mid = 2). The two median formulas
      // give different verdicts for the top agent, so this case pins down
      // averaging vs. taking a single middle element:
      //   correct  → median = (sorted[1] + sorted[2]) / 2 = (4 + 6) / 2 = 5
      //              → 10 / 5 = 2.0x → warning
      //   mutant   → median = sorted[mid] = 6 → 10 / 6 = 1.67x → none
      const agents = [
        agentWithCpt("opus", 2),
        agentWithCpt("opus", 4),
        agentWithCpt("opus", 6),
        agentWithCpt("opus", 10),
      ];
      const result = detectCostAnomalies(agents);
      expect(result.get(3)?.anomalyLevel).toBe("warning");
      expect(result.get(3)?.anomalyReason).toContain("2.0x");
    });
  });

  describe("edge cases", () => {
    it("returns an empty map for no agents", () => {
      expect(detectCostAnomalies([]).size).toBe(0);
    });

    it("flags none for a single eligible agent (it is its own median → 1x)", () => {
      const result = detectCostAnomalies([agentWithCpt("opus", 5)]);
      expect(result.get(0)?.anomalyLevel).toBe("none");
    });

    it("flags none for a model whose entire cohort has fewer than 2 turns", () => {
      // No agent for this model is eligible → no median is computed for it →
      // every agent falls through to none (and is never a divide-by-undefined).
      const agents = [
        { model: "opus", estimatedCost: 500, apiTurns: 1 },
        { model: "opus", estimatedCost: 1, apiTurns: 1 },
      ];
      const result = detectCostAnomalies(agents);
      expect(result.get(0)?.anomalyLevel).toBe("none");
      expect(result.get(1)?.anomalyLevel).toBe("none");
    });

    it("does not divide-by-zero or flag when the model median is zero", () => {
      // All eligible agents have zero cost → median 0 → guard `median > 0`
      // skips them → none, no NaN/Infinity ratio.
      const agents = [
        { model: "opus", estimatedCost: 0, apiTurns: 2 },
        { model: "opus", estimatedCost: 0, apiTurns: 3 },
      ];
      const result = detectCostAnomalies(agents);
      expect(result.get(0)?.anomalyLevel).toBe("none");
      expect(result.get(1)?.anomalyLevel).toBe("none");
    });
  });
});
