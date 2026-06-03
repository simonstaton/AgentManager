import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetGauge } from "./BudgetGauge";

describe("BudgetGauge", () => {
  it("renders 'No limit' when budgetUsd is not provided", () => {
    render(<BudgetGauge spent={1.5} />);
    expect(screen.getByText("No limit")).toBeTruthy();
  });

  it("renders 'No limit' when budgetUsd is zero", () => {
    render(<BudgetGauge spent={0} budgetUsd={0} />);
    expect(screen.getByText("No limit")).toBeTruthy();
  });

  it("renders spend/budget label when budgetUsd is provided", () => {
    render(<BudgetGauge spent={0.5} budgetUsd={2} />);
    // Should contain percentage and amounts
    expect(screen.getByText(/25%/)).toBeTruthy();
  });

  it("renders without crashing at 0% usage", () => {
    render(<BudgetGauge spent={0} budgetUsd={10} />);
    expect(document.body).toBeTruthy();
  });

  it("renders without crashing at 100% usage", () => {
    render(<BudgetGauge spent={10} budgetUsd={10} />);
    expect(screen.getByText(/100%/)).toBeTruthy();
  });

  it("clamps negative spent to 0", () => {
    render(<BudgetGauge spent={-5} budgetUsd={10} />);
    expect(screen.getByText(/0%/)).toBeTruthy();
  });

  it("shows Budget label in md size", () => {
    render(<BudgetGauge spent={1} budgetUsd={5} size="md" />);
    expect(screen.getByText("Budget")).toBeTruthy();
  });

  it("does not show Budget label in sm size", () => {
    render(<BudgetGauge spent={1} budgetUsd={5} size="sm" />);
    expect(screen.queryByText("Budget")).toBeNull();
  });
});
