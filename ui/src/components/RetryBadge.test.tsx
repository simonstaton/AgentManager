import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RetryState } from "./RetryBadge";
import { RetryBadge } from "./RetryBadge";

describe("RetryBadge", () => {
  const baseRetry: RetryState = { attempt: 1 };

  it("renders without crashing (full variant)", () => {
    render(<RetryBadge retry={baseRetry} />);
    expect(document.body).toBeTruthy();
  });

  it("renders without crashing (compact variant)", () => {
    render(<RetryBadge retry={baseRetry} compact />);
    expect(document.body).toBeTruthy();
  });

  it("shows attempt number in full variant", () => {
    render(<RetryBadge retry={{ attempt: 3 }} />);
    expect(screen.getByText(/attempt 3/i)).toBeTruthy();
  });

  it("shows attempt number in compact variant", () => {
    render(<RetryBadge retry={{ attempt: 2 }} compact />);
    expect(screen.getByText(/Retry #2/)).toBeTruthy();
  });

  it("shows error status code when error_status is provided", () => {
    render(<RetryBadge retry={{ attempt: 1, error_status: 429 }} compact />);
    expect(screen.getByText(/429/)).toBeTruthy();
  });

  it("shows 'err' label when no error_status is provided", () => {
    render(<RetryBadge retry={{ attempt: 1 }} compact />);
    expect(screen.getByText(/err/)).toBeTruthy();
  });

  it("has role=status for accessibility", () => {
    render(<RetryBadge retry={baseRetry} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("has role=status in compact variant", () => {
    render(<RetryBadge retry={baseRetry} compact />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("shows error message when error is provided (full variant)", () => {
    render(<RetryBadge retry={{ attempt: 1, error: "Rate limit exceeded" }} />);
    expect(screen.getByText("Rate limit exceeded")).toBeTruthy();
  });

  it("shows countdown seconds when retry_delay_ms is provided", () => {
    render(<RetryBadge retry={{ attempt: 1, retry_delay_ms: 5000 }} />);
    // Countdown text should be present (5s initially)
    expect(screen.getByText(/\ds$/)).toBeTruthy();
  });
});
