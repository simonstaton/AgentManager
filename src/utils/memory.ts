import fs from "node:fs";

const CGROUP_MEMORY_PATH = "/sys/fs/cgroup/memory.current";
const CGROUP_MEMORY_MAX_PATH = "/sys/fs/cgroup/memory.max";

/** Fallback limit when cgroup is unavailable: 2 GiB */
const DEFAULT_MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

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
 * Read container memory limit from cgroup v2 memory.max.
 * Returns DEFAULT_MEMORY_LIMIT_BYTES when cgroup is unavailable or limit is
 * set to "max" (unlimited), which is typical in local dev environments.
 */
export function getContainerMemoryLimit(): number {
  try {
    const raw = fs.readFileSync(CGROUP_MEMORY_MAX_PATH, "utf-8").trim();
    if (raw === "max") return DEFAULT_MEMORY_LIMIT_BYTES;
    const bytes = Number(raw);
    if (Number.isNaN(bytes) || bytes <= 0) return DEFAULT_MEMORY_LIMIT_BYTES;
    return bytes;
  } catch {
    return DEFAULT_MEMORY_LIMIT_BYTES;
  }
}
