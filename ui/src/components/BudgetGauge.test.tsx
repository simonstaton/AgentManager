import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetGauge } from "./BudgetGauge";

describe("BudgetGauge", () => {
  it("shows No limit when budgetUsd is not set", () => {
    render(<BudgetGauge spent={1.5} />);
    expect(screen.getByText("No limit")).toBeTruthy();
  });

  it("shows percentage when budgetUsd is set", () => {
    render(<BudgetGauge spent={1} budgetUsd={4} />);
    expect(screen.getByText(/25%/)).toBeTruthy();
  });

  it("clamps negative spent to zero", () => {
    render(<BudgetGauge spent={-5} budgetUsd={10} />);
    expect(screen.getByText(/0%/)).toBeTruthy();
  });

  it("shows Budget label in md size", () => {
    render(<BudgetGauge spent={1} budgetUsd={4} size="md" />);
    expect(screen.getByText("Budget")).toBeTruthy();
  });

  it("hides Budget label in sm size", () => {
    render(<BudgetGauge spent={1} budgetUsd={4} size="sm" />);
    expect(screen.queryByText("Budget")).toBeNull();
  });
});
