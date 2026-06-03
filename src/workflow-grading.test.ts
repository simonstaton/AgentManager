import { describe, expect, it } from "vitest";
import type { GradeResult, RiskLevel } from "./grading";
import { confidenceFromGrade, gradeGate } from "./workflow-grading";

function makeGrade(overallRisk: RiskLevel): GradeResult {
  return {
    taskId: "t1",
    agentId: "a1",
    ticketClarity: "medium",
    fixConfidence: "medium",
    blastRadius: "isolated",
    overallRisk,
    createdAt: new Date().toISOString(),
  };
}

describe("gradeGate", () => {
  it("returns NEEDS_HUMAN for high risk", () => {
    expect(gradeGate(makeGrade("high"))).toBe("NEEDS_HUMAN");
  });

  it("returns CREATE_PR for medium risk", () => {
    expect(gradeGate(makeGrade("medium"))).toBe("CREATE_PR");
  });

  it("returns CREATE_PR for low risk", () => {
    expect(gradeGate(makeGrade("low"))).toBe("CREATE_PR");
  });
});

describe("confidenceFromGrade", () => {
  it("returns lower confidence for high risk", () => {
    expect(confidenceFromGrade(makeGrade("high"))).toBe(10);
  });

  it("returns higher confidence for low risk", () => {
    expect(confidenceFromGrade(makeGrade("low"))).toBe(80);
  });

  it("returns mid confidence for medium risk", () => {
    expect(confidenceFromGrade(makeGrade("medium"))).toBe(45);
  });
});
