import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { extractErrorMessage, requireExists } from "./route-helpers";

describe("requireExists", () => {
  it("returns true when value is truthy", () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    expect(requireExists(res, "value", "not found")).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns false and sends 404 when value is falsy", () => {
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }), json } as unknown as Response;
    expect(requireExists(res, null, "item not found")).toBe(false);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("sends the error message in the json body", () => {
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }), json } as unknown as Response;
    requireExists(res, undefined, "custom error");
    expect(json).toHaveBeenCalledWith({ error: "custom error" });
  });
});

describe("extractErrorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(extractErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns strings directly", () => {
    expect(extractErrorMessage("plain string")).toBe("plain string");
  });

  it("converts other values to string", () => {
    expect(extractErrorMessage(42)).toBe("42");
    expect(extractErrorMessage({ toString: () => "obj" })).toBe("obj");
  });
});
