/// <reference types="vitest/globals" />

type CheckStatus = "pending" | "passing" | "failing" | "none";
type CheckEntry = { conclusion?: string; state?: string; status?: string };

function deriveStatus(rollup: CheckEntry[] | null | undefined): CheckStatus {
  if (!rollup?.length) return "none";
  if (rollup.some((c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR")) return "failing";
  if (rollup.some((c) => c.status === "IN_PROGRESS" || c.status === "QUEUED")) return "pending";
  if (rollup.every((c) => c.conclusion === "SUCCESS")) return "passing";
  return "none";
}

describe("checks status derivation – extra cases", () => {
  it("returns none for empty array", () => expect(deriveStatus([])).toBe("none"));
  it("returns none for null", () => expect(deriveStatus(null)).toBe("none"));
  it("returns failing on FAILURE", () => expect(deriveStatus([{ conclusion: "FAILURE" }])).toBe("failing"));
  it("returns failing on ERROR", () => expect(deriveStatus([{ conclusion: "ERROR" }])).toBe("failing"));
  it("failing takes priority over pending", () => {
    expect(deriveStatus([{ conclusion: "FAILURE" }, { status: "IN_PROGRESS" }])).toBe("failing");
  });
  it("returns pending for IN_PROGRESS", () => expect(deriveStatus([{ status: "IN_PROGRESS" }])).toBe("pending"));
  it("returns pending for QUEUED", () => expect(deriveStatus([{ status: "QUEUED" }])).toBe("pending"));
  it("returns passing when all SUCCESS", () => {
    expect(deriveStatus([{ conclusion: "SUCCESS" }, { conclusion: "SUCCESS" }])).toBe("passing");
  });
});
