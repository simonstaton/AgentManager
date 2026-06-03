import { describe, expect, it } from "vitest";
import { BudgetCeilingMonitor, evaluateBudgetCeiling } from "./budget-ceiling";

describe("evaluateBudgetCeiling", () => {
  it("disabled when ceiling <= 0", () => {
    expect(evaluateBudgetCeiling(100, 0).blocked).toBe(false);
    expect(evaluateBudgetCeiling(100, -1).blocked).toBe(false);
    expect(evaluateBudgetCeiling(100, 0).ratio).toBe(0);
  });

  it("not blocked at 0% spend", () => {
    expect(evaluateBudgetCeiling(0, 100).blocked).toBe(false);
    expect(evaluateBudgetCeiling(0, 100).level).toBe(0);
  });

  it("warning at 50%", () => {
    const r = evaluateBudgetCeiling(50, 100);
    expect(r.level).toBe(50);
    expect(r.blocked).toBe(false);
  });

  it("warning at 80%", () => {
    expect(evaluateBudgetCeiling(80, 100).level).toBe(80);
  });

  it("blocked at 100%", () => {
    const r = evaluateBudgetCeiling(100, 100);
    expect(r.blocked).toBe(true);
    expect(r.level).toBe(100);
  });

  it("blocked above 100%", () => {
    expect(evaluateBudgetCeiling(150, 100).blocked).toBe(true);
  });
});

describe("BudgetCeilingMonitor", () => {
  it("fires crossed=50 when first crossing 50%", () => {
    const m = new BudgetCeilingMonitor();
    const r = m.observe(51, 100);
    expect(r.crossed).toBe(50);
  });

  it("does not re-fire same level", () => {
    const m = new BudgetCeilingMonitor();
    m.observe(51, 100);
    const r = m.observe(55, 100);
    expect(r.crossed).toBeNull();
  });

  it("fires 80 after 50 is already latched", () => {
    const m = new BudgetCeilingMonitor();
    m.observe(51, 100);
    const r = m.observe(81, 100);
    expect(r.crossed).toBe(80);
  });

  it("reset clears latch so 50 can fire again", () => {
    const m = new BudgetCeilingMonitor();
    m.observe(51, 100);
    m.reset();
    expect(m.observe(51, 100).crossed).toBe(50);
  });
});
