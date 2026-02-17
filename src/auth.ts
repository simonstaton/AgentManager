import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest, AuthPayload } from "./types";

if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not set. Exiting.");
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const API_KEY = process.env.API_KEY || "";

function base64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

function signJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token: string): AuthPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);

  // timingSafeEqual requires buffers of same length
  if (sigBuf.length !== expectedBuf.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as AuthPayload;
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function exchangeKeyForToken(apiKey: string): string | null {
  if (!API_KEY) return null;
  const provided = Buffer.from(apiKey);
  const expected = Buffer.from(API_KEY);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: "user",
    iat: now,
    exp: now + 86400, // 24h
  });
}

export function verifyToken(token: string): AuthPayload | null {
  return verifyJwt(token);
}

/** Generate a long-lived service token for agents to call the platform API */
export function generateServiceToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: "agent-service",
    iat: now,
    exp: now + 7 * 86400, // 7 days
  });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health and token exchange
  if (req.path === "/api/health" || req.path === "/api/auth/token") {
    next();
    return;
  }

  // Skip auth for non-API routes (static files)
  if (!req.path.startsWith("/api/")) {
    next();
    return;
  }

  // Try Bearer token first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const payload = verifyJwt(authHeader.slice(7));
    if (payload) {
      (req as AuthenticatedRequest).user = payload;
      next();
      return;
    }
  }

  // Fall back to x-api-key for backward compat
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
  if (apiKeyHeader && API_KEY) {
    const provided = Buffer.from(apiKeyHeader);
    const expected = Buffer.from(API_KEY);
    if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
      const now = Math.floor(Date.now() / 1000);
      (req as AuthenticatedRequest).user = { sub: "api-key-user", iat: now, exp: now + 86400 };
      next();
      return;
    }
  }

  res.status(401).json({ error: "Unauthorized" });
}
