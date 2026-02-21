import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { corsMiddleware, parseCorsOrigins, resetCorsOriginsCache } from "./cors";

function mockReq(method: string, origin?: string): Request {
  return { method, headers: origin ? { origin } : {} } as unknown as Request;
}

function mockRes(): Response & { _headers: Record<string, string>; _status: number | null; _ended: boolean } {
  const headers: Record<string, string> = {};
  const res = {
    _headers: headers,
    _status: null as number | null,
    _ended: false,
    setHeader: vi.fn((key: string, val: string) => {
      headers[key] = val;
    }),
    status: vi.fn(function (this: typeof res, code: number) {
      res._status = code;
      return res;
    }),
    end: vi.fn(() => {
      res._ended = true;
    }),
  };
  return res as unknown as Response & { _headers: Record<string, string>; _status: number | null; _ended: boolean };
}

describe("parseCorsOrigins", () => {
  it("returns null for undefined", () => {
    expect(parseCorsOrigins(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCorsOrigins("")).toBeNull();
    expect(parseCorsOrigins("  ")).toBeNull();
  });

  it('returns "*" for wildcard', () => {
    expect(parseCorsOrigins("*")).toBe("*");
    expect(parseCorsOrigins(" * ")).toBe("*");
  });

  it("returns a Set for comma-separated origins", () => {
    const result = parseCorsOrigins("https://a.com,https://b.com");
    expect(result).toBeInstanceOf(Set);
    expect(result).toEqual(new Set(["https://a.com", "https://b.com"]));
  });

  it("trims whitespace around origins", () => {
    const result = parseCorsOrigins(" https://a.com , https://b.com ");
    expect(result).toEqual(new Set(["https://a.com", "https://b.com"]));
  });

  it("returns a Set for a single origin", () => {
    const result = parseCorsOrigins("https://app.example.com");
    expect(result).toEqual(new Set(["https://app.example.com"]));
  });

  it("filters empty entries from trailing commas", () => {
    const result = parseCorsOrigins("https://a.com,,https://b.com,");
    expect(result).toEqual(new Set(["https://a.com", "https://b.com"]));
  });
});

describe("corsMiddleware", () => {
  const originalEnv = process.env.CORS_ORIGINS;

  beforeEach(() => {
    resetCorsOriginsCache();
    process.env.CORS_ORIGINS = undefined;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CORS_ORIGINS = originalEnv;
    } else {
      process.env.CORS_ORIGINS = undefined;
    }
  });

  it("does nothing when CORS_ORIGINS is not set", () => {
    const req = mockReq("GET", "https://other.com");
    const res = mockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it("sets wildcard origin for CORS_ORIGINS=*", () => {
    process.env.CORS_ORIGINS = "*";
    const req = mockReq("GET", "https://any.com");
    const res = mockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(res._headers["Access-Control-Allow-Methods"]).toContain("GET");
    expect(res._headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    // Wildcard should NOT set credentials
    expect(res._headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("reflects matching origin with credentials", () => {
    process.env.CORS_ORIGINS = "https://app.example.com,https://staging.example.com";
    const req = mockReq("GET", "https://app.example.com");
    const res = mockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
    expect(res._headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(res._headers.Vary).toBe("Origin");
  });

  it("does not set CORS headers for non-matching origin", () => {
    process.env.CORS_ORIGINS = "https://app.example.com";
    const req = mockReq("GET", "https://evil.com");
    const res = mockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("returns 403 for OPTIONS preflight from non-matching origin", () => {
    process.env.CORS_ORIGINS = "https://app.example.com";
    const req = mockReq("OPTIONS", "https://evil.com");
    const res = mockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._ended).toBe(true);
  });

  it("returns 204 for valid OPTIONS preflight", () => {
    process.env.CORS_ORIGINS = "https://app.example.com";
    const req = mockReq("OPTIONS", "https://app.example.com");
    const res = mockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(204);
    expect(res._ended).toBe(true);
    expect(res._headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
    expect(res._headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect(res._headers["Access-Control-Max-Age"]).toBe("86400");
  });

  it("returns 204 for wildcard OPTIONS preflight", () => {
    process.env.CORS_ORIGINS = "*";
    const req = mockReq("OPTIONS", "https://any.com");
    const res = mockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(204);
    expect(res._headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("handles request with no Origin header and explicit origins", () => {
    process.env.CORS_ORIGINS = "https://app.example.com";
    const req = mockReq("GET");
    const res = mockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
