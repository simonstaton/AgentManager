import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokenUsageBar } from "./TokenUsageBar";

describe("TokenUsageBar", () => {
  it("renders null when limit is zero", () => {
    const { container } = render(<TokenUsageBar current={100} limit={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when limit is negative", () => {
    const { container } = render(<TokenUsageBar current={100} limit={-1} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders bar when limit > 0", () => {
    const { container } = render(<TokenUsageBar current={50} limit={200} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("shows label when provided", () => {
    render(<TokenUsageBar current={50} limit={200} label="Tokens" />);
    expect(screen.getByText("Tokens")).toBeTruthy();
  });

  it("uses formatValue for display", () => {
    render(<TokenUsageBar current={1000} limit={5000} formatValue={(n) => `${n}t`} />);
    expect(screen.getByText(/1000t/)).toBeTruthy();
  });

  it("renders without label or formatValue", () => {
    const { container } = render(<TokenUsageBar current={50} limit={100} />);
    expect(container.firstChild).not.toBeNull();
  });
});
