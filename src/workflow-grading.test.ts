import { describe, expect, it } from "vitest";
import type { GradeResult } from "./grading";
import { buildGraderPrompt, confidenceFromGrade, gradeGate } from "./workflow-grading";

function makeGrade(
  overallRisk: "low" | "medium" | "high",
  ticketClarity: "high" | "medium" | "low" = "high",
  fixConfidence: "high" | "medium" | "low" = "high",
  blastRadius: "isolated" | "moderate" | "broad" = "isolated",
): GradeResult {
  return {
    taskId: "task-1",
    agentId: "agent-1",
    ticketClarity,
    fixConfidence,
    blastRadius,
    overallRisk,
    createdAt: new Date().toISOString(),
  };
}

describe("gradeGate", () => {
  it("returns CREATE_PR for low risk", () => {
    expect(gradeGate(makeGrade("low"))).toBe("CREATE_PR");
  });

  it("returns CREATE_PR for medium risk", () => {
    expect(gradeGate(makeGrade("medium"))).toBe("CREATE_PR");
  });

  it("returns NEEDS_HUMAN for high risk", () => {
    expect(gradeGate(makeGrade("high"))).toBe("NEEDS_HUMAN");
  });
});

describe("confidenceFromGrade", () => {
  it("returns 80 for low risk (100 - 20)", () => {
    expect(confidenceFromGrade(makeGrade("low"))).toBe(80);
  });

  it("returns 45 for medium risk (100 - 55)", () => {
    expect(confidenceFromGrade(makeGrade("medium"))).toBe(45);
  });

  it("returns 10 for high risk (100 - 90)", () => {
    expect(confidenceFromGrade(makeGrade("high"))).toBe(10);
  });

  it("high-risk grade yields confidence < 60 (below medium threshold)", () => {
    expect(confidenceFromGrade(makeGrade("high"))).toBeLessThan(60);
  });

  it("low-risk confidence > high-risk confidence", () => {
    expect(confidenceFromGrade(makeGrade("low"))).toBeGreaterThan(confidenceFromGrade(makeGrade("high")));
  });
});

describe("buildGraderPrompt", () => {
  it("includes workflowId and ticketUrl in the prompt", () => {
    const prompt = buildGraderPrompt("wf-abc", "https://linear.app/a/issue/X-1");
    expect(prompt).toContain("wf-abc");
    expect(prompt).toContain("https://linear.app/a/issue/X-1");
  });

  it("instructs the agent to be READ-ONLY", () => {
    const prompt = buildGraderPrompt("wf-abc", "https://linear.app/a/issue/X-1");
    expect(prompt.toUpperCase()).toContain("READ-ONLY");
  });
});
