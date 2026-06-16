import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WorkflowForPanel } from "./ProgressPanel";
import { ProgressPanel } from "./ProgressPanel";

const makeWorkflow = (overrides?: Partial<WorkflowForPanel>): WorkflowForPanel => ({
  id: "wf-test-1",
  status: "running",
  agents: [{ id: "a1", name: "architect", role: "architect" }],
  createdAt: new Date("2026-06-01T00:00:00Z").toISOString(),
  ...overrides,
});

describe("ProgressPanel", () => {
  it("renders without crashing for a running workflow", () => {
    const { container } = render(<ProgressPanel workflow={makeWorkflow()} onCancel={() => {}} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("displays the workflow status", () => {
    render(<ProgressPanel workflow={makeWorkflow({ status: "completed" })} onCancel={() => {}} />);
    // Status should appear somewhere in the rendered output
    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).toMatch(/completed|done|finished/);
  });

  it("shows error message when workflow has failed", () => {
    const workflow = makeWorkflow({ status: "failed", error: "Something went wrong" });
    render(<ProgressPanel workflow={workflow} onCancel={() => {}} />);
    expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
  });

  it("lists agent names in the panel", () => {
    const workflow = makeWorkflow({
      agents: [
        { id: "a1", name: "backend-dev", role: "developer" },
        { id: "a2", name: "reviewer", role: "reviewer" },
      ],
    });
    render(<ProgressPanel workflow={workflow} onCancel={() => {}} />);
    expect(screen.getByText(/backend-dev/i)).toBeTruthy();
  });

  it("renders cancel button for running workflow", () => {
    render(<ProgressPanel workflow={makeWorkflow({ status: "running" })} onCancel={() => {}} />);
    const cancelBtn = screen.queryByRole("button", { name: /cancel/i });
    expect(cancelBtn).not.toBeNull();
  });

  it("does not show error section when workflow is healthy", () => {
    render(
      <ProgressPanel
        workflow={makeWorkflow({ status: "running", error: undefined })}
        onCancel={() => {}}
       
      />,
    );
    expect(screen.queryByText(/error/i)).toBeNull();
  });
});
