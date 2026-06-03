import fs from "node:fs";

const CGROUP_MEMORY_PATH = "/sys/fs/cgroup/memory.current";
const CGROUP_MEMORY_LIMIT_PATH = "/sys/fs/cgroup/memory.max";

/** 4 GiB fallback when container limit is unavailable or set to "max". */
const DEFAULT_MEMORY_LIMIT = 4 * 1024 * 1024 * 1024;

/**
 * Read container-level memory usage from cgroup v2. This captures the server
 * process AND all child `claude` CLI processes, unlike process.memoryUsage().rss
 * which only measures the Node.js server itself.
 * Falls back to process RSS when cgroup files aren't available (local dev).
 */
export function getContainerMemoryUsage(): number {
  try {
    const raw = fs.readFileSync(CGROUP_MEMORY_PATH, "utf-8").trim();
    const bytes = Number(raw);
    if (Number.isNaN(bytes)) return process.memoryUsage().rss;
    return bytes;
  } catch {
    return process.memoryUsage().rss;
  }
}

/**
 * Read container memory limit from cgroup v2.
 * Returns a fallback of 4 GiB when the file is absent, unparseable, or set to "max"
 * (unlimited containers), so callers can always divide usage/limit safely.
 */
export function getContainerMemoryLimit(): number {
  try {
    const raw = fs.readFileSync(CGROUP_MEMORY_LIMIT_PATH, "utf-8").trim();
    if (raw === "max") return DEFAULT_MEMORY_LIMIT;
    const bytes = Number(raw);
    if (Number.isNaN(bytes) || bytes <= 0) return DEFAULT_MEMORY_LIMIT;
    return bytes;
  } catch {
    return DEFAULT_MEMORY_LIMIT;
  }
}
