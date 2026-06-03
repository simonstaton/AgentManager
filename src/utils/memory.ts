import fs from "node:fs";
import os from "node:os";

const CGROUP_MEMORY_PATH = "/sys/fs/cgroup/memory.current";
const CGROUP_MEMORY_LIMIT_PATH = "/sys/fs/cgroup/memory.max";

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
 * Read the container memory limit from cgroup v2. Returns the hard limit set
 * by the container runtime (Cloud Run memory allocation). Falls back to
 * os.totalmem() when cgroup files aren't available (local dev) or when the
 * limit is set to "max" (unlimited cgroup).
 */
export function getContainerMemoryLimit(): number {
  try {
    const raw = fs.readFileSync(CGROUP_MEMORY_LIMIT_PATH, "utf-8").trim();
    if (raw === "max") return os.totalmem();
    const bytes = Number(raw);
    if (Number.isNaN(bytes) || bytes <= 0) return os.totalmem();
    return bytes;
  } catch {
    return os.totalmem();
  }
}
