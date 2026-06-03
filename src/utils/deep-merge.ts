/**
 * Minimal recursive deep-merge for sparse config overrides.
 *
 * Semantics:
 *   - Plain objects merge recursively.
 *   - Scalars, arrays, and class instances replace wholesale.
 *   - A key absent from the override inherits the base value.
 *   - A key set to null in the override reverts that key to the base value.
 *   - undefined override values are ignored.
 *
 * Pure: never mutates either argument.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base)) {
    if (override === undefined || override === null) return base;
    return override as T;
  }
  if (!isPlainObject(override)) return { ...base } as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override)) {
    const ov = override[key];
    if (ov === undefined) continue;
    if (ov === null) continue;
    out[key] = deepMerge(out[key] as unknown, ov);
  }
  return out as T;
}
