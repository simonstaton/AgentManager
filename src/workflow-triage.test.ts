import { describe, expect, it } from "vitest";
import { buildValidationResult, clarityFromChecks, verdictFromClarity } from "./workflow-triage";

const allTrue = { substance: true, goalClarity: true, doneDef: true, scopeSignal: true, actionability: true };
const allFalse = { substance: false, goalClarity: false, doneDef: false, scopeSignal: false, actionability: false };

describe("clarityFromChecks", () => {
  it("returns high when all checks pass", () => {
    expect(clarityFromChecks(allTrue)).toBe("high");
  });

  it("returns low when actionability is false", () => {
    expect(clarityFromChecks({ ...allTrue, actionability: false })).toBe("low");
  });

  it("returns low when substance is false", () => {
    expect(clarityFromChecks({ ...allTrue, substance: false })).toBe("low");
  });

  it("returns low when neither doneDef nor scopeSignal", () => {
    expect(clarityFromChecks({ ...allTrue, doneDef: false, scopeSignal: false })).toBe("low");
  });

  it("returns medium when only one of goalClarity/doneDef/scopeSignal is true", () => {
    expect(clarityFromChecks({ ...allFalse, substance: true, actionability: true, doneDef: true })).toBe("medium");
  });

  it("returns high when sat >= 2 with doneDef or scopeSignal", () => {
    expect(
      clarityFromChecks({ ...allFalse, substance: true, actionability: true, doneDef: true, goalClarity: true }),
    ).toBe("high");
  });
});

describe("verdictFromClarity", () => {
  it("maps high to accept", () => expect(verdictFromClarity("high")).toBe("accept"));
  it("maps medium to accept_with_caveats", () => expect(verdictFromClarity("medium")).toBe("accept_with_caveats"));
  it("maps low to reject", () => expect(verdictFromClarity("low")).toBe("reject"));
});

describe("buildValidationResult", () => {
  it("injects default missing/suggestions for reject with empty arrays", () => {
    const r = buildValidationResult(allFalse, "reject", "low");
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it("preserves provided missing/suggestions", () => {
    const r = buildValidationResult(allFalse, "reject", "low", ["custom miss"], ["custom sugg"]);
    expect(r.missing).toEqual(["custom miss"]);
    expect(r.suggestions).toEqual(["custom sugg"]);
  });

  it("accept result has no injected missing", () => {
    const r = buildValidationResult(allTrue, "accept", "high");
    expect(r.missing).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it("includes readError when provided", () => {
    const r = buildValidationResult(allFalse, "reject", "low", [], [], "not_found");
    expect(r.readError).toBe("not_found");
  });

  it("omits readError when not provided", () => {
    const r = buildValidationResult(allTrue, "accept", "high");
    expect("readError" in r).toBe(false);
  });
});
