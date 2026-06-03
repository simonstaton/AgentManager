/// <reference types="vitest/globals" />
import { deriveChecksStatus } from "./pull-requests";

describe("deriveChecksStatus – edge cases", () => {
  it("returns none for undefined rollup", () => {
    expect(deriveChecksStatus(undefined as never)).toBe("none");
  });

  it("prefers failing over pending when both present", () => {
    const rollup = [
      { conclusion: "FAILURE", state: undefined, status: undefined },
      { conclusion: undefined, state: undefined, status: "IN_PROGRESS" },
    ];
    expect(deriveChecksStatus(rollup)).toBe("failing");
  });

  it("returns passing when all checks have SUCCESS conclusion", () => {
    const rollup = [
      { conclusion: "SUCCESS", state: undefined, status: undefined },
      { conclusion: "SUCCESS", state: undefined, status: undefined },
    ];
    expect(deriveChecksStatus(rollup)).toBe("passing");
  });

  it("returns pending for QUEUED status", () => {
    expect(deriveChecksStatus([{ conclusion: undefined, state: undefined, status: "QUEUED" }])).toBe("pending");
  });
});
