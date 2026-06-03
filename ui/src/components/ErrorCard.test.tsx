import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorCard } from "./ErrorCard";

describe("ErrorCard", () => {
  it("renders error message", () => {
    render(<ErrorCard message="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });
  it("renders suggestion when provided", () => {
    render(<ErrorCard message="err" suggestion="Try again later" />);
    expect(screen.getByText("Try again later")).toBeTruthy();
  });
  it("omits suggestion section when not provided", () => {
    render(<ErrorCard message="err" />);
    expect(screen.queryByText("Next step")).toBeNull();
  });
  it("renders retry button when onRetry provided", () => {
    render(<ErrorCard message="err" onRetry={vi.fn()} />);
    expect(screen.getByRole("button")).toBeTruthy();
  });
  it("calls onRetry on click", () => {
    const fn = vi.fn();
    render(<ErrorCard message="err" onRetry={fn} />);
    fireEvent.click(screen.getByRole("button"));
    expect(fn).toHaveBeenCalled();
  });
  it("disables button when retrying", () => {
    render(<ErrorCard message="err" onRetry={vi.fn()} retrying />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
  it("has role=alert", () => {
    render(<ErrorCard message="err" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("renders partialBranch when provided", () => {
    render(<ErrorCard message="err" partialBranch="fix/branch" />);
    expect(screen.getByText("fix/branch")).toBeTruthy();
  });
});
