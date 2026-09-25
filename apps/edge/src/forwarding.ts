/**
 * Request handling and configuration helpers for the edge Worker. Kept free of Workers-only
 * imports so they can be unit-tested in Node.
 */

/** Variables the Next.js server reads (see packages/core/src/env.ts). */
export const WEB_ENV_KEYS = [
  "NODE_ENV",
  "APP_URL",
  "LOG_LEVEL",
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "DATABASE_CA_CERT",
  "REDIS_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "TRUSTED_PROXIES",
  "ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AI_PROVIDER",
  "AI_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "SMTP_URL",
  "EMAIL_FROM",
] as const;

/** Variables the background worker reads (see apps/worker/src/env.ts). */
export const JOBS_ENV_KEYS = [
  "NODE_ENV",
  "LOG_LEVEL",
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "DATABASE_CA_CERT",
  "REDIS_URL",
  "INGEST_INTERVAL_MINUTES",
  "INGEST_CONCURRENCY",
] as const;

/** Copies the listed variables that are set, so each container only receives what it uses. */
export function pickEnv(env: object, keys: readonly string[]): Record<string, string> {
  const source = env as Record<string, unknown>;
  const picked: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value !== "") picked[key] = value;
  }
  return picked;
}

/** Parses the configured number of web containers, falling back to `fallback` when invalid. */
export function instanceCount(value: unknown, fallback = 2): number {
  const count = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(count) && count >= 1 && count <= 20 ? count : fallback;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Visits to any other address of this Worker (its workers.dev address, or an old domain after a
 * move) are sent to the same path on APP_URL, the one address where sign-in works.
 */
export function canonicalRedirect(request: Request, appUrl: unknown): Response | null {
  if (typeof appUrl !== "string" || appUrl === "") return null;
  let canonical: URL;
  try {
    canonical = new URL(appUrl);
  } catch {
    return null;
  }
  const url = new URL(request.url);
  if (url.host === canonical.host || LOCAL_HOSTS.has(url.hostname)) return null;
  // 308 keeps the method, so a form posted to an old address still arrives as a POST.
  return Response.redirect(
    new URL(`${url.pathname}${url.search}`, canonical.origin).toString(),
    308,
  );
}

/** Plain-HTTP visits are sent to HTTPS (local development excepted). */
export function httpsRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || LOCAL_HOSTS.has(url.hostname)) return null;
  url.protocol = "https:";
  return Response.redirect(url.toString(), 301);
}

/**
 * Prepares a visitor's request for the web container. Cloudflare reports the connecting client
 * in `CF-Connecting-IP`; it replaces any forwarding headers the client sent, because the app's
 * rate limits and audit log trust them.
 */
export function forwardToOrigin(request: Request): Request {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
    headers.set("x-real-ip", clientIp);
  }
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  headers.set("x-forwarded-host", url.host);
  return new Request(request, { headers });
}
