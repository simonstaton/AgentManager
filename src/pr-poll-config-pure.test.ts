/// <reference types="vitest/globals" />

const PR_POLL_INTERVAL_MS = 30_000;

function clampInterval(ms: number, min = 5_000, max = 300_000): number {
  return Math.max(min, Math.min(max, ms));
}

function shouldRefreshOnVisible(
  wasHidden: boolean,
  timeSinceLastFetch: number,
  threshold = PR_POLL_INTERVAL_MS,
): boolean {
  return wasHidden && timeSinceLastFetch >= threshold;
}

describe("PR poll interval config", () => {
  it("default poll interval is 30 seconds", () => {
    expect(PR_POLL_INTERVAL_MS).toBe(30_000);
  });
  it("clampInterval respects min bound", () => {
    expect(clampInterval(1_000)).toBe(5_000);
  });
  it("clampInterval respects max bound", () => {
    expect(clampInterval(999_999)).toBe(300_000);
  });
  it("clampInterval passes through valid interval", () => {
    expect(clampInterval(30_000)).toBe(30_000);
  });
});

describe("shouldRefreshOnVisible", () => {
  it("returns true when page was hidden and enough time has passed", () => {
    expect(shouldRefreshOnVisible(true, 30_000)).toBe(true);
  });
  it("returns false when page was not hidden", () => {
    expect(shouldRefreshOnVisible(false, 60_000)).toBe(false);
  });
  it("returns false when not enough time has passed", () => {
    expect(shouldRefreshOnVisible(true, 10_000)).toBe(false);
  });
});
