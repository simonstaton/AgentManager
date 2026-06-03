import { describe, expect, it } from "vitest";
import type { RepoGateConfig } from "./repo-gate-store";
import {
  CONFIDENCE_LEVELS,
  getMergePolicy,
  isMergeAllowed,
  parseConfidenceLabel,
  repoKeyFromOwnerRepo,
} from "./routes/merge-gate";

describe("parseConfidenceLabel", () => {
  it("parses 'confidence: high' label", () => {
    expect(parseConfidenceLabel(["confidence: high"])).toBe("high");
  });

  it("parses 'confidence: medium' label", () => {
    expect(parseConfidenceLabel(["confidence: medium"])).toBe("medium");
  });

  it("parses 'confidence: low' label", () => {
    expect(parseConfidenceLabel(["confidence: low"])).toBe("low");
  });

  it("parses 'confidence: critical' label", () => {
    expect(parseConfidenceLabel(["confidence: critical"])).toBe("critical");
  });

  it("returns null when no confidence label exists", () => {
    expect(parseConfidenceLabel(["bug", "enhancement"])).toBeNull();
  });

  it("returns null for empty label array", () => {
    expect(parseConfidenceLabel([])).toBeNull();
  });

  it("finds confidence label among other labels", () => {
    expect(parseConfidenceLabel(["bug", "confidence: low", "priority: high"])).toBe("low");
  });

  it("is case-insensitive", () => {
    expect(parseConfidenceLabel(["Confidence: High"])).toBe("high");
    expect(parseConfidenceLabel(["CONFIDENCE: CRITICAL"])).toBe("critical");
  });

  it("handles whitespace in labels", () => {
    expect(parseConfidenceLabel(["  confidence: high  "])).toBe("high");
  });

  it("returns most restrictive label when multiple confidence labels exist", () => {
    expect(parseConfidenceLabel(["confidence: high", "confidence: low"])).toBe("low");
    expect(parseConfidenceLabel(["confidence: low", "confidence: high"])).toBe("low");
    expect(parseConfidenceLabel(["confidence: medium", "confidence: critical"])).toBe("critical");
  });
});

describe("isMergeAllowed", () => {
  it("allows merge for high confidence", () => {
    expect(isMergeAllowed("high")).toBe(true);
  });

  it("blocks merge for medium confidence", () => {
    expect(isMergeAllowed("medium")).toBe(false);
  });

  it("blocks merge for low confidence", () => {
    expect(isMergeAllowed("low")).toBe(false);
  });

  it("blocks merge for critical confidence", () => {
    expect(isMergeAllowed("critical")).toBe(false);
  });

  it("blocks merge for all non-high levels", () => {
    for (const level of CONFIDENCE_LEVELS) {
      if (level === "high") {
        expect(isMergeAllowed(level)).toBe(true);
      } else {
        expect(isMergeAllowed(level)).toBe(false);
      }
    }
  });
});

describe("getMergePolicy", () => {
  it("returns allowed=true for high confidence", () => {
    const policy = getMergePolicy("high");
    expect(policy.allowed).toBe(true);
    expect(policy.reason).toBeTruthy();
  });

  it("returns allowed=false with reason for medium confidence", () => {
    const policy = getMergePolicy("medium");
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toContain("human review");
  });

  it("returns allowed=false with reason for low confidence", () => {
    const policy = getMergePolicy("low");
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toContain("human review");
  });

  it("returns allowed=false with reason for critical confidence", () => {
    const policy = getMergePolicy("critical");
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toContain("human review");
  });

  it("returns a policy for every defined confidence level", () => {
    for (const level of CONFIDENCE_LEVELS) {
      const policy = getMergePolicy(level);
      expect(policy).toBeDefined();
      expect(typeof policy.allowed).toBe("boolean");
      expect(typeof policy.reason).toBe("string");
      expect(policy.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("getMergePolicy with effective repo config override", () => {
  const customPolicy = {
    mergePolicy: {
      high: { allowed: true, reason: "custom: high ok" },
      medium: { allowed: true, reason: "custom: medium ok for this repo" },
      low: { allowed: false, reason: "custom: low blocked" },
      critical: { allowed: false, reason: "custom: critical blocked" },
    },
    autoMergeThreshold: "medium" as const,
  };

  it("uses effective config policy when provided", () => {
    const policy = getMergePolicy("medium", customPolicy);
    expect(policy.allowed).toBe(true);
    expect(policy.reason).toBe("custom: medium ok for this repo");
  });

  it("falls back to builtin when effective config not provided", () => {
    const policy = getMergePolicy("medium");
    expect(policy.allowed).toBe(false);
  });

  it("falls back to builtin for levels not in the override", () => {
    const partial = {
      mergePolicy: {} as RepoGateConfig["mergePolicy"],
      autoMergeThreshold: "high" as const,
    };
    const policy = getMergePolicy("high", partial);
    expect(policy.allowed).toBe(true);
  });
});

describe("repoKeyFromOwnerRepo", () => {
  it("extracts repo name from owner/repo format", () => {
    expect(repoKeyFromOwnerRepo("simonstaton/AgentManager")).toBe("AgentManager");
  });

  it("handles plain repo name (no slash)", () => {
    expect(repoKeyFromOwnerRepo("AgentManager")).toBe("AgentManager");
  });

  it("sanitizes special characters", () => {
    expect(repoKeyFromOwnerRepo("org/my.repo-name_v2")).toBe("myrepo-name_v2");
  });
});
