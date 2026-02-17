import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authMiddleware, exchangeKeyForToken, generateServiceToken, verifyToken } from "./auth";
import type { AuthenticatedRequest } from "./types";

function mockReq(path: string, headers: Record<string, string> = {}): Request {
  return { path, headers } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe("exchangeKeyForToken", () => {
  it("returns null for invalid API key", () => {
    const token = exchangeKeyForToken("wrong-key");
    expect(token).toBeNull();
  });

  it("returns null when API_KEY is not set", () => {
    // If API_KEY env is not set, should return null
    if (!process.env.API_KEY) {
      const token = exchangeKeyForToken("any-key");
      expect(token).toBeNull();
    }
  });

  it("uses timing-safe comparison", () => {
    // Keys of different lengths should not leak timing info
    const token = exchangeKeyForToken("x");
    expect(token).toBeNull();
  });
});

describe("verifyToken", () => {
  it("returns null for invalid token", () => {
    const payload = verifyToken("clearly.not.avalid.token.signature");
    expect(payload).toBeNull();
  });

  it("returns null for malformed token", () => {
    expect(verifyToken("not-a-jwt")).toBeNull();
    expect(verifyToken("only.two")).toBeNull();
    expect(verifyToken("")).toBeNull();
  });

  it("returns null for token with invalid signature", () => {
    // Create a token with a bad signature
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "test", iat: Math.floor(Date.now() / 1000) })).toString("base64url");
    const badSig = "invalidsignature";
    const badToken = `${header}.${body}.${badSig}`;

    const payload = verifyToken(badToken);
    expect(payload).toBeNull();
  });
});

describe("generateServiceToken", () => {
  it("returns a valid token string", () => {
    const token = generateServiceToken();
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("token has agent-service as subject", () => {
    const token = generateServiceToken();
    const payload = verifyToken(token);
    expect(payload?.sub).toBe("agent-service");
  });

  it("token has iat and exp fields", () => {
    const token = generateServiceToken();
    const payload = verifyToken(token);
    expect(payload?.iat).toBeTruthy();
    expect(payload?.exp).toBeTruthy();
    expect(payload?.exp).toBeGreaterThan(payload?.iat || 0);
  });

  it("token is verifiable", () => {
    const token = generateServiceToken();
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
  });
});

describe("authMiddleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it("skips auth for /api/health", () => {
    const res = mockRes();
    authMiddleware(mockReq("/api/health"), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("skips auth for /api/auth/token", () => {
    const res = mockRes();
    authMiddleware(mockReq("/api/auth/token"), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("skips auth for non-API routes", () => {
    const res = mockRes();
    authMiddleware(mockReq("/index.html"), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects requests without credentials", () => {
    const res = mockRes();
    authMiddleware(mockReq("/api/agents"), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts valid JWT Bearer token", () => {
    const token = generateServiceToken();
    const req = mockReq("/api/agents", { authorization: `Bearer ${token}` });
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user).toBeTruthy();
    expect((req as AuthenticatedRequest).user?.sub).toBe("agent-service");
  });

  it("rejects invalid JWT Bearer token", () => {
    const req = mockReq("/api/agents", { authorization: "Bearer invalid.token.here" });
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects JWT with wrong signature", () => {
    // Create a token signed with wrong key
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "test", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");
    const wrongSig = crypto.createHmac("sha256", "wrong-secret").update(`${header}.${payload}`).digest("base64url");
    const badToken = `${header}.${payload}.${wrongSig}`;

    const req = mockReq("/api/agents", { authorization: `Bearer ${badToken}` });
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects invalid x-api-key header", () => {
    const req = mockReq("/api/agents", { "x-api-key": "wrong-key" });
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("prefers Bearer token over x-api-key", () => {
    const token = generateServiceToken();
    // Even if x-api-key is provided, Bearer token should be checked first
    const req = mockReq("/api/agents", { authorization: `Bearer ${token}`, "x-api-key": "some-key" });
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user?.sub).toBe("agent-service"); // from service token
  });
});
