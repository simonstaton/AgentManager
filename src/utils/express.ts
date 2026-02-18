/**
 * Normalise an Express 5 route parameter to a plain string.
 *
 * Express 5 types `req.params.*` as `string | string[]` to account for
 * wildcard and repeated segments. Most routes only need the first (or only)
 * value, so this helper unwraps the array case.
 *
 * @param val - The raw parameter value from `req.params`.
 * @returns The first element if `val` is an array, otherwise `val` as-is.
 */
export function param(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}
