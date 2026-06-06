import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RepoGateConfigResponse } from "../api";
import { RepoGateConfigPanel } from "./RepoGateConfigPanel";

const makeConfig = (overrides?: Partial<RepoGateConfigResponse>): RepoGateConfigResponse => ({
  defaults: {
    schemaVersion: 1,
    autoMergeThreshold: "high",
    mergePolicy: {
      high: { allowed: true, reason: "" },
      medium: { allowed: false, reason: "" },
      low: { allowed: false, reason: "" },
      critical: { allowed: false, reason: "" },
    },
    grading: {
      weights: { clarity: 0.33, confidence: 0.34, blastRadius: 0.33 },
      riskThresholds: { mediumMinTotal: 50, highMinTotal: 80, worstAxisForcesMedium: true },
    },
    prSize: { maxLines: 400, maxFiles: 20, maxConcerns: 1 },
    guardrailOverrides: { allowUnreviewedShell: false, allowDirectPushToMain: false },
  },
  overrides: {},
  effective: {
    schemaVersion: 1,
    autoMergeThreshold: "high",
    mergePolicy: {
      high: { allowed: true, reason: "" },
      medium: { allowed: false, reason: "" },
      low: { allowed: false, reason: "" },
      critical: { allowed: false, reason: "" },
    },
    grading: {
      weights: { clarity: 0.33, confidence: 0.34, blastRadius: 0.33 },
      riskThresholds: { mediumMinTotal: 50, highMinTotal: 80, worstAxisForcesMedium: true },
    },
    prSize: { maxLines: 400, maxFiles: 20, maxConcerns: 1 },
    guardrailOverrides: { allowUnreviewedShell: false, allowDirectPushToMain: false },
  },
  updatedAt: null,
  updatedBy: null,
  ...overrides,
});

const makeApi = (configOverrides?: Partial<RepoGateConfigResponse>) => ({
  getRepoGateConfig: vi.fn().mockResolvedValue(makeConfig(configOverrides)),
  updateRepoGateConfig: vi.fn().mockResolvedValue(makeConfig(configOverrides)),
  resetRepoGateConfig: vi.fn().mockResolvedValue(makeConfig()),
});

describe("RepoGateConfigPanel", () => {
  it("renders the Gate Config accordion header", () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    expect(screen.getByText("Gate Config")).toBeTruthy();
  });

  it("does not call getRepoGateConfig before expanding", () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    expect(api.getRepoGateConfig).not.toHaveBeenCalled();
  });

  it("shows loading state while fetching after expand", async () => {
    const api = {
      getRepoGateConfig: vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(makeConfig()), 100))),
      updateRepoGateConfig: vi.fn(),
      resetRepoGateConfig: vi.fn(),
    };
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    expect(screen.getByText("Loading gate config...")).toBeTruthy();
  });

  it("loads and displays config after expanding", async () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => {
      expect(screen.getByText("Auto-merge Threshold")).toBeTruthy();
    });
    expect(api.getRepoGateConfig).toHaveBeenCalledWith("my-repo");
  });

  it("renders all confidence level buttons for threshold selector", async () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Auto-merge Threshold"));
    for (const level of ["high", "medium", "low", "critical"]) {
      expect(screen.getAllByText(level).length).toBeGreaterThan(0);
    }
  });

  it("renders merge policy toggle switches", async () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Merge Policy"));
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBe(4);
  });

  it("renders PR size limit inputs", async () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("PR Size Limits"));
    expect(screen.getByLabelText("Max Lines")).toBeTruthy();
    expect(screen.getByLabelText("Max Files")).toBeTruthy();
  });

  it("shows Save button after loading", async () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Save"));
    expect(screen.getByText("Save")).toBeTruthy();
  });

  it("does not show Reset to defaults button when no overrides present", async () => {
    const api = makeApi({ overrides: {} });
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Save"));
    expect(screen.queryByText("Reset to defaults")).toBeNull();
  });

  it("shows Reset to defaults button when overrides present", async () => {
    const api = makeApi({ overrides: { autoMergeThreshold: "medium" } });
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Reset to defaults"));
    expect(screen.getByText("Reset to defaults")).toBeTruthy();
  });

  it("shows customized badge when overrides are present", async () => {
    const api = makeApi({ overrides: { autoMergeThreshold: "medium" } });
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Save"));
    expect(screen.getByText("customized")).toBeTruthy();
  });

  it("does not show customized badge when no overrides", async () => {
    const api = makeApi({ overrides: {} });
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Save"));
    expect(screen.queryByText("customized")).toBeNull();
  });

  it("calls updateRepoGateConfig on Save click", async () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Save"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(api.updateRepoGateConfig).toHaveBeenCalledWith(
        "my-repo",
        expect.objectContaining({
          autoMergeThreshold: "high",
        }),
      );
    });
  });

  it("shows success message after saving", async () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Save"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(screen.getByText("Gate config saved")).toBeTruthy();
    });
  });

  it("calls resetRepoGateConfig on Reset click", async () => {
    const api = makeApi({ overrides: { autoMergeThreshold: "medium" } });
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Reset to defaults"));
    fireEvent.click(screen.getByText("Reset to defaults"));
    await waitFor(() => {
      expect(api.resetRepoGateConfig).toHaveBeenCalledWith("my-repo");
    });
  });

  it("shows success message after resetting", async () => {
    const api = makeApi({ overrides: { autoMergeThreshold: "medium" } });
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText("Reset to defaults"));
    fireEvent.click(screen.getByText("Reset to defaults"));
    await waitFor(() => {
      expect(screen.getByText("Reset to defaults")).toBeTruthy();
    });
    await waitFor(() => {
      expect(api.resetRepoGateConfig).toHaveBeenCalled();
    });
  });

  it("toggles a merge policy switch", async () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getAllByRole("switch"));
    const switches = screen.getAllByRole("switch");
    // "high" switch should initially be checked (allowed: true)
    expect(switches[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(switches[0]);
    expect(switches[0].getAttribute("aria-checked")).toBe("false");
  });

  it("does not load data twice on re-expand", async () => {
    const api = makeApi();
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    const header = screen.getByText("Gate Config");
    fireEvent.click(header); // expand
    await waitFor(() => screen.getByText("Save"));
    fireEvent.click(header); // collapse
    fireEvent.click(header); // re-expand
    // Should still only have called once since data is cached
    expect(api.getRepoGateConfig).toHaveBeenCalledTimes(1);
  });

  it("displays last updated timestamp when present", async () => {
    const api = makeApi({ updatedAt: "2024-01-15T10:00:00.000Z", updatedBy: "alice" });
    render(<RepoGateConfigPanel api={api as never} repoName="my-repo" />);
    fireEvent.click(screen.getByText("Gate Config"));
    await waitFor(() => screen.getByText(/Last updated:/));
    expect(screen.getByText(/alice/)).toBeTruthy();
  });
});
