import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RetryState } from "./RetryBadge";
import { RetryBadge } from "./RetryBadge";

describe("RetryBadge", () => {
  const retry: RetryState = { attempt: 2, error_status: 429, error: "rate limited" };

  it("renders attempt in non-compact mode", () => {
    render(<RetryBadge retry={retry} />);
    expect(screen.getByText(/attempt 2/)).toBeTruthy();
  });

  it("renders compact version", () => {
    render(<RetryBadge retry={retry} compact />);
    expect(screen.getByText(/Retry #2/)).toBeTruthy();
  });

  it("has role=status", () => {
    render(<RetryBadge retry={retry} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("shows error message in non-compact mode", () => {
    render(<RetryBadge retry={retry} />);
    expect(screen.getByText("rate limited")).toBeTruthy();
  });

  it("shows error_status code", () => {
    render(<RetryBadge retry={retry} />);
    expect(screen.getByText(/429/)).toBeTruthy();
  });

  it("renders with no error_status or error", () => {
    const minimalRetry: RetryState = { attempt: 1 };
    render(<RetryBadge retry={minimalRetry} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
