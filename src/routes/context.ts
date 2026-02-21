import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import { logger } from "../logger";
import { deleteContextFile, syncContextFile } from "../storage";
import { errorMessage } from "../types";
import { getContextDir } from "../utils/context";

function validateContextPath(contextDir: string, name: string): string | null {
  if (name.includes("..")) return null;
  const filepath = path.resolve(path.join(contextDir, name));
  if (!filepath.startsWith(path.resolve(contextDir) + path.sep) && filepath !== path.resolve(contextDir)) {
    return null;
  }
  return filepath;
}

export function createContextRouter() {
  const router = express.Router();

  // List context files (recursive)
  router.get("/api/context", (_req, res) => {
    const contextDir = getContextDir();
    try {
      fs.mkdirSync(contextDir, { recursive: true });

      const result: Array<{ name: string; size: number; modified: string }> = [];

      const scan = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.startsWith(".")) continue;
            scan(fullPath, `${prefix}${entry.name}/`);
          } else if (entry.name.endsWith(".md")) {
            const stat = fs.statSync(fullPath);
            result.push({
              name: `${prefix}${entry.name}`,
              size: stat.size,
              modified: stat.mtime.toISOString(),
            });
          }
        }
      };

      scan(contextDir, "");
      res.json(result);
    } catch {
      res.json([]);
    }
  });

  // Read context file (query-param route supporting subdirectories)
  router.get("/api/context/file", (req: Request, res: Response) => {
    const contextDir = getContextDir();
    const name = req.query.name;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name query param required" });
      return;
    }

    const filepath = validateContextPath(contextDir, name);
    if (!filepath) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const content = fs.readFileSync(filepath, "utf-8");
    res.json({ content });
  });

  // Create/update context file (query-param route supporting subdirectories)
  router.put("/api/context/file", (req: Request, res: Response) => {
    const contextDir = getContextDir();
    const { name, content } = req.body ?? {};

    if (!name || typeof name !== "string" || !name.endsWith(".md")) {
      res.status(400).json({ error: "name must be a .md filename" });
      return;
    }
    if (typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const filepath = validateContextPath(contextDir, name);
    if (!filepath) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content, "utf-8");
    syncContextFile(name).catch((err: unknown) => {
      logger.error(`[context] Failed to sync context file ${name}`, { error: errorMessage(err) });
    });
    res.json({ ok: true });
  });

  // Delete context file (query-param route supporting subdirectories)
  router.delete("/api/context/file", (req: Request, res: Response) => {
    const contextDir = getContextDir();
    const name = req.query.name;

    if (!name || typeof name !== "string" || !name.endsWith(".md")) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    const filepath = validateContextPath(contextDir, name);
    if (!filepath) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    fs.unlinkSync(filepath);
    deleteContextFile(name).catch((err: unknown) => {
      logger.error(`[context] Failed to delete context file ${name}`, { error: errorMessage(err) });
    });
    res.json({ ok: true });
  });

  return router;
}
