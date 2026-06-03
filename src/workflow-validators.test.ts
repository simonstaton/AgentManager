import { describe, expect, it } from "vitest";
import { estimateWorkflowCost, parseLinearUrl } from "./workflow-validators";

describe("parseLinearUrl", () => {
  it("parses a valid Linear URL", () => {
    const r = parseLinearUrl("https://linear.app/myteam/issue/ENG-123");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.issueId).toBe("ENG-123");
    expect(r.parsed.team).toBe("ENG");
    expect(r.parsed.workspace).toBe("myteam");
    expect(r.parsed.safeUrl).toBe("https://linear.app/myteam/issue/ENG-123");
  });

  it("normalises issue ID to uppercase", () => {
    const r = parseLinearUrl("https://linear.app/myteam/issue/eng-123");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.issueId).toBe("ENG-123");
  });

  it("strips query params from safeUrl", () => {
    const r = parseLinearUrl("https://linear.app/myteam/issue/ENG-123?foo=bar");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.safeUrl).toBe("https://linear.app/myteam/issue/ENG-123");
  });

  it("rejects empty string", () => {
    const r = parseLinearUrl("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("EMPTY");
  });

  it("rejects http:// URLs", () => {
    const r = parseLinearUrl("http://linear.app/myteam/issue/ENG-123");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_HTTPS");
  });

  it("rejects wrong domain", () => {
    const r = parseLinearUrl("https://linear.evil.com/myteam/issue/ENG-123");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("WRONG_DOMAIN");
  });

  it("rejects invalid path (no issue segment)", () => {
    const r = parseLinearUrl("https://linear.app/myteam/ENG-123");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("INVALID_PATH");
  });

  it("rejects invalid issue ID format", () => {
    const r = parseLinearUrl("https://linear.app/myteam/issue/123-abc");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("INVALID_ISSUE_ID");
  });
});

describe("estimateWorkflowCost", () => {
  it("returns a CostEstimate with non-zero min/max for XS", () => {
    const e = estimateWorkflowCost("XS");
    expect(e.size).toBe("XS");
    expect(e.minCostUsd).toBeGreaterThan(0);
    expect(e.maxCostUsd).toBeGreaterThan(e.minCostUsd);
    expect(e.signals.length).toBeGreaterThan(0);
  });

  it("XL costs more than XS", () => {
    const xs = estimateWorkflowCost("XS");
    const xl = estimateWorkflowCost("XL");
    expect(xl.minCostUsd).toBeGreaterThan(xs.minCostUsd);
  });

  it("uses default model when not specified", () => {
    const e = estimateWorkflowCost("M");
    expect(e.model).toBeTruthy();
  });
});
