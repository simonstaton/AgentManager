export function getContextDir(): string {
  return process.env.SHARED_CONTEXT_DIR || "/shared-context";
}
