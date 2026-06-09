import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LinearWorkflow } from "./WorkflowDrawer";
import { WorkflowDrawer } from "./WorkflowDrawer";

// Mock ProgressPanel since it lives in PR #169 (not yet merged)
vi.mock("./ProgressPanel", () => ({
  ProgressPanel: ({ workflow, onCancel }: { workflow: { id: string; status: string }; onCancel: () => void }) => (
    <div data-testid={`progress-panel-${workflow.id}`} data-status={workflow.status}>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

const makeWorkflow = (overrides?: Partial<LinearWorkflow>): LinearWorkflow => ({
  id: "wf-1",
  linearUrl: "https://linear.app/team/issue/TEAM-123",
  repository: "org/repo",
  status: "running",
  agents: [{ id: "a1", name: "architect", role: "architect" }],
  createdAt: "2026-06-03T00:00:00Z",
  updatedAt: "2026-06-03T00:00:00Z",
  ...overrides,
});

const makeAuthFetch = (workflows: LinearWorkflow[] = []) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => workflows,
  } as Response);

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onStartNew: vi.fn(),
  authFetch: makeAuthFetch(),
  toast: vi.fn(),
};

describe("WorkflowDrawer", () => {
  it("renders without crashing when open", () => {
    render(<WorkflowDrawer {...defaultProps} />);
    expect(document.body).toBeTruthy();
  });

  it("shows drawer panel with aria-label", () => {
    render(<WorkflowDrawer {...defaultProps} />);
    expect(screen.getByRole("complementary", { name: /workflow progress/i })).toBeTruthy();
  });

  it("shows 'No workflows yet' when list is empty", async () => {
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([])} />);
    await waitFor(() => {
      expect(screen.getByText("No workflows yet")).toBeTruthy();
    });
  });

  it("shows 'Start workflow' button when empty", async () => {
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([])} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start workflow/i })).toBeTruthy();
    });
  });

  it("calls onStartNew when '+ New' button clicked", async () => {
    const onStartNew = vi.fn();
    render(<WorkflowDrawer {...defaultProps} onStartNew={onStartNew} authFetch={makeAuthFetch([])} />);
    await waitFor(() => screen.getByText("No workflows yet"));
    fireEvent.click(screen.getByRole("button", { name: /\+ new/i }));
    expect(onStartNew).toHaveBeenCalled();
  });

  it("calls onClose when close button clicked", async () => {
    const onClose = vi.fn();
    render(<WorkflowDrawer {...defaultProps} onClose={onClose} authFetch={makeAuthFetch([])} />);
    await waitFor(() => screen.getByText("No workflows yet"));
    fireEvent.click(screen.getByRole("button", { name: /close workflows drawer/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape key pressed", () => {
    const onClose = vi.fn();
    render(<WorkflowDrawer {...defaultProps} onClose={onClose} authFetch={makeAuthFetch([])} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not listen for Escape key when closed", () => {
    const onClose = vi.fn();
    render(<WorkflowDrawer {...defaultProps} open={false} onClose={onClose} authFetch={makeAuthFetch([])} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders workflow list item with issue label", async () => {
    const wf = makeWorkflow();
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([wf])} />);
    await waitFor(() => {
      expect(screen.getByText("TEAM-123")).toBeTruthy();
    });
  });

  it("renders repository name in workflow list", async () => {
    const wf = makeWorkflow({ repository: "my-org/my-repo" });
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([wf])} />);
    await waitFor(() => {
      expect(screen.getByText("my-org/my-repo")).toBeTruthy();
    });
  });

  it("shows active badge when there are running workflows", async () => {
    const wf = makeWorkflow({ status: "running" });
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([wf])} />);
    await waitFor(() => {
      expect(screen.getByText("1 active")).toBeTruthy();
    });
  });

  it("does not show active badge when no active workflows", async () => {
    const wf = makeWorkflow({ status: "completed" });
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([wf])} />);
    await waitFor(() => screen.getByText("TEAM-123"));
    expect(screen.queryByText(/active/i)).toBeNull();
  });

  it("expands workflow on click and shows ProgressPanel", async () => {
    const wf = makeWorkflow({ id: "wf-abc", status: "completed" });
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([wf])} />);
    await waitFor(() => screen.getByText("TEAM-123"));
    // Click the workflow row toggle (closest button ancestor of the issue label)
    fireEvent.click(screen.getByText("TEAM-123").closest("button") as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId("progress-panel-wf-abc")).toBeTruthy();
    });
  });

  it("auto-expands active workflow", async () => {
    const wf = makeWorkflow({ id: "wf-auto", status: "running" });
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([wf])} />);
    await waitFor(() => {
      expect(screen.getByTestId("progress-panel-wf-auto")).toBeTruthy();
    });
  });

  it("shows PR link when prUrl is provided and workflow is expanded", async () => {
    const wf = makeWorkflow({ id: "wf-pr", status: "running", prUrl: "https://github.com/org/repo/pull/42" });
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([wf])} />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /github\.com\/org\/repo\/pull\/42/i })).toBeTruthy();
    });
  });

  it("calls authFetch DELETE when cancel button clicked inside ProgressPanel", async () => {
    const authFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [makeWorkflow({ id: "wf-cancel", status: "running" })],
    } as unknown as Response);
    render(<WorkflowDrawer {...defaultProps} authFetch={authFetch} />);
    await waitFor(() => screen.getByTestId("progress-panel-wf-cancel"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith("/api/workflows/wf-cancel", { method: "DELETE" });
    });
  });

  it("renders backdrop when open", () => {
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([])} />);
    const backdrop = document.querySelector(".bg-black\\/40");
    expect(backdrop).toBeTruthy();
  });

  it("hides backdrop when closed", () => {
    render(<WorkflowDrawer {...defaultProps} open={false} authFetch={makeAuthFetch([])} />);
    const backdrop = document.querySelector(".bg-black\\/40");
    expect(backdrop).toBeNull();
  });

  it("applies translate-x-full class when closed", () => {
    render(<WorkflowDrawer {...defaultProps} open={false} authFetch={makeAuthFetch([])} />);
    const panel = screen.getByRole("complementary", { name: /workflow progress/i });
    expect(panel.className).toContain("translate-x-full");
  });

  it("applies translate-x-0 class when open", () => {
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([])} />);
    const panel = screen.getByRole("complementary", { name: /workflow progress/i });
    expect(panel.className).toContain("translate-x-0");
  });

  it("shows 'Workflows' heading", () => {
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch([])} />);
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    expect(screen.getByText("Workflows")).toBeTruthy();
  });

  it("multiple workflows render as separate list items", async () => {
    const workflows = [
      makeWorkflow({ id: "wf-1", linearUrl: "https://linear.app/team/issue/TEAM-1", status: "running" }),
      makeWorkflow({ id: "wf-2", linearUrl: "https://linear.app/team/issue/TEAM-2", status: "completed" }),
    ];
    render(<WorkflowDrawer {...defaultProps} authFetch={makeAuthFetch(workflows)} />);
    await waitFor(() => {
      expect(screen.getByText("TEAM-1")).toBeTruthy();
      expect(screen.getByText("TEAM-2")).toBeTruthy();
    });
  });
});
