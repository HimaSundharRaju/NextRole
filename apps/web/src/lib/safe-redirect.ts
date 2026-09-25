/** Only same-site relative paths are allowed as post-login destinations (prevents open redirects). */
export function safeNextPath(
  value: string | string[] | null | undefined,
  fallback = "/dashboard",
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.startsWith("/\\")
  ) {
    return fallback;
  }
  return candidate;
}
