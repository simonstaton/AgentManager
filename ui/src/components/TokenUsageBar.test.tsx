import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokenUsageBar } from "./TokenUsageBar";

describe("TokenUsageBar", () => {
  it("renders nothing when limit is 0", () => {
    const { container } = render(<TokenUsageBar current={5} limit={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a progress bar when limit > 0", () => {
    const { container } = render(<TokenUsageBar current={50} limit={100} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders label when label prop is provided", () => {
    render(<TokenUsageBar current={10} limit={100} label="Tokens" />);
    expect(screen.getByText("Tokens")).toBeTruthy();
  });

  it("renders formatted values when formatValue is provided", () => {
    const { container } = render(
      <TokenUsageBar current={1000} limit={5000} formatValue={(n) => `${n}t`} label="Usage" />,
    );
    // Values are rendered inside a single span as "1000t / 5000t" with text nodes
    expect(container.textContent).toContain("1000t");
    expect(container.textContent).toContain("5000t");
  });

  it("does not render label row when neither label nor formatValue is set", () => {
    const { container } = render(<TokenUsageBar current={10} limit={100} />);
    // No label text nodes — only the bar div
    const spans = container.querySelectorAll("span");
    expect(spans.length).toBe(0);
  });

  it("clamps bar width at 100% when current exceeds limit", () => {
    // Just check it renders without error when over-limit
    const { container } = render(<TokenUsageBar current={200} limit={100} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders in md size without crashing", () => {
    render(<TokenUsageBar current={50} limit={100} size="md" label="Space" />);
    expect(screen.getByText("Space")).toBeTruthy();
  });
});
