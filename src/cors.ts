import type { NextFunction, Request, Response } from "express";

/**
 * Configurable CORS middleware.
 *
 * Reads the `CORS_ORIGINS` env var:
 *   - Not set / empty → no CORS headers (same-origin only, current default)
 *   - `"*"` → allow any origin (no credentials)
 *   - Comma-separated origins → allow only those origins (with credentials)
 *
 * Examples:
 *   CORS_ORIGINS=*
 *   CORS_ORIGINS=https://app.example.com
 *   CORS_ORIGINS=https://app.example.com,https://staging.example.com
 */

const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization, Cache-Control, X-Requested-With";
const MAX_AGE = "86400"; // 24 hours — browsers cache preflight results

export function parseCorsOrigins(raw: string | undefined): Set<string> | "*" | null {
  if (!raw || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (trimmed === "*") return "*";

  const origins = trimmed
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  return origins.length > 0 ? new Set(origins) : null;
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const allowed = parseCorsOrigins(process.env.CORS_ORIGINS);

  // No CORS configured — skip entirely (same-origin-only mode)
  if (allowed === null) {
    next();
    return;
  }

  const requestOrigin = req.headers.origin;

  if (allowed === "*") {
    // Wildcard: allow any origin but without credentials
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (requestOrigin && allowed.has(requestOrigin)) {
    // Explicit origin match — reflect the origin and allow credentials
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    // Vary on Origin so caches don't serve wrong CORS headers
    res.setHeader("Vary", "Origin");
  } else {
    // Origin not in the allow-list. For non-preflight requests, just don't
    // set CORS headers — the browser will block the response. For preflight
    // OPTIONS requests, respond with 403 to make the rejection explicit.
    if (req.method === "OPTIONS") {
      res.status(403).end();
      return;
    }
    next();
    return;
  }

  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  res.setHeader("Access-Control-Max-Age", MAX_AGE);

  // Preflight requests get an immediate 204 (no body needed)
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
