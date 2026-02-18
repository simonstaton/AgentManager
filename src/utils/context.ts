/**
 * Return the absolute path of the shared context directory.
 *
 * Reads `SHARED_CONTEXT_DIR` from the environment, falling back to
 * `/shared-context` when the variable is not set.
 *
 * @returns Absolute path to the shared context directory.
 */
export function getContextDir(): string {
  return process.env.SHARED_CONTEXT_DIR || "/shared-context";
}
