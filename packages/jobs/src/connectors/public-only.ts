import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Fetcher } from "./types";

/**
 * Whether an IP address is one a crawler must never reach: private, loopback, link-local,
 * shared (CGNAT), multicast or otherwise reserved.
 */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith("::ffff:")) {
    const mapped = v6.slice(7);
    return isIP(mapped) === 4 ? isPrivateAddress(mapped) : true;
  }
  return v6 === "::" || v6 === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(v6);
}

type Resolve = (host: string) => Promise<string[]>;

const resolveAll: Resolve = async (host) =>
  (await lookup(host, { all: true })).map((entry) => entry.address);

const MAX_REDIRECTS = 5;
const CHECK_TTL_MS = 10 * 60_000;

/**
 * Wraps fetch so it only reaches the public web: http(s) URLs whose host resolves to public
 * addresses, checked again at every redirect. Discovery fetches pages from links users submit,
 * and without this they could point the worker at internal services.
 */
export function publicOnly(inner: Fetcher, resolve: Resolve = resolveAll): Fetcher {
  const checked = new Map<string, { ok: boolean; at: number }>();

  async function assertPublic(url: URL): Promise<void> {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(`Only web addresses can be fetched, not ${url.protocol}`);
    }
    if (url.username || url.password) throw new Error("Addresses with credentials aren't fetched");
    const host = url.hostname;
    let entry = checked.get(host);
    if (!entry || Date.now() - entry.at > CHECK_TTL_MS) {
      let ok = false;
      try {
        const addresses = isIP(host) ? [host] : await resolve(host);
        ok = addresses.length > 0 && addresses.every((address) => !isPrivateAddress(address));
      } catch {
        ok = false;
      }
      entry = { ok, at: Date.now() };
      checked.set(host, entry);
    }
    if (!entry.ok) throw new Error(`${host} isn't a public web address`);
  }

  const wrapped = async (input: string | URL | Request, init?: RequestInit) => {
    let url = new URL(input instanceof Request ? input.url : input.toString());
    let request = init;
    for (let hop = 0; ; hop++) {
      await assertPublic(url);
      const response = await inner(url.href, { ...request, redirect: "manual" });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) return response;
      if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects from ${url.href}`);
      url = new URL(location, url);
      // Like browsers, a 303 (or a redirected POST answered with 301/302) continues as a GET.
      if (response.status === 303 || (request?.method === "POST" && response.status < 307)) {
        request = { ...request, method: "GET", body: undefined };
      }
    }
  };
  return wrapped as Fetcher;
}
