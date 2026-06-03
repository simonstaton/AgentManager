import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "../api";
import { StatusReportPanel } from "./StatusReportPanel";

class FakeEventSource {
  onmessage: ((e: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  close() {}
}
Object.defineProperty(globalThis, "EventSource", { value: FakeEventSource, writable: true });

function makeAgent(name = "TestAgent", status: Agent["status"] = "running"): Agent {
  return {
    id: "a1",
    name,
    status,
    workspaceDir: "/tmp/ws",
    model: "claude-sonnet-4-6",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivity: "2026-01-01T00:00:00.000Z",
  } as Agent;
}

describe("StatusReportPanel", () => {
  it("shows dialog title", () => {
    render(<StatusReportPanel agents={[]} requestedAt={0} onClose={vi.fn()} />);
    expect(screen.getByText("Agent Status Reports")).toBeTruthy();
  });
  it("shows no agents message when empty", () => {
    render(<StatusReportPanel agents={[]} requestedAt={0} onClose={vi.fn()} />);
    expect(screen.getByText("No agents active")).toBeTruthy();
  });
  it("renders agent name", () => {
    render(<StatusReportPanel agents={[makeAgent("Clippy")]} requestedAt={0} onClose={vi.fn()} />);
    expect(screen.getByText("Clippy")).toBeTruthy();
  });
  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<StatusReportPanel agents={[]} requestedAt={0} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close status reports"));
    expect(onClose).toHaveBeenCalled();
  });
  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<StatusReportPanel agents={[]} requestedAt={0} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("shows 0 of N agents reported initially", () => {
    render(<StatusReportPanel agents={[makeAgent()]} requestedAt={0} onClose={vi.fn()} />);
    expect(screen.getByText(/0 of 1 agent/)).toBeTruthy();
  });
});
