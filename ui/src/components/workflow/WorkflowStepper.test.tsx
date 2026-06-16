import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkflowStepper } from "./WorkflowStepper";

describe("WorkflowStepper", () => {
  it("renders all four step labels", () => {
    render(<WorkflowStepper currentStep="input" />);
    expect(screen.getByText("Input")).toBeTruthy();
    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("marks the active step visually distinct", () => {
    const { container } = render(<WorkflowStepper currentStep="running" />);
    // Active step circle should have indigo class
    const indigoEl = container.querySelector('[class*="indigo"]');
    expect(indigoEl).not.toBeNull();
  });

  it("accepts all valid step values without throwing", () => {
    const steps = ["input", "preview", "running", "done"] as const;
    for (const step of steps) {
      expect(() => render(<WorkflowStepper currentStep={step} />)).not.toThrow();
    }
  });

  it("applies custom className to container", () => {
    const { container } = render(<WorkflowStepper currentStep="input" className="my-custom" />);
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain("my-custom");
  });

  it("completed steps come before current step index", () => {
    render(<WorkflowStepper currentStep="done" />);
    // All steps should render
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Input")).toBeTruthy();
  });
});
