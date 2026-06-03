import type { Response } from "express";

export function requireExists(res: Response, value: unknown, errorMessage: string): boolean {
  if (!value) {
    res.status(404).json({ error: errorMessage });
    return false;
  }
  return true;
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
