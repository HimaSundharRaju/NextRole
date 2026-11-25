import { BlockList, isIP } from "node:net";

/** Adds a proxy address or range ("192.0.2.1", "10.0.0.0/8", "2001:db8::/32") to the list. */
function addTrusted(list: BlockList, entry: string): void {
  const [address = "", prefix] = entry.trim().split("/");
  const family = isIP(address);
  if (family === 0) return;
  const type = family === 6 ? "ipv6" : "ipv4";
  if (prefix === undefined) {
    list.addAddress(address, type);
    return;
  }
  const bits = Number(prefix);
  if (!Number.isInteger(bits) || bits < 0 || bits > (family === 6 ? 128 : 32)) return;
  list.addSubnet(address, bits, type);
}

/**
 * The visitor's address, for rate limits. `X-Forwarded-For` is read from the right, where our own
 * proxies add what they saw, and the first address that isn't one of `trustedProxies` wins: the
 * leftmost entries are whatever the visitor sent. A chain with an entry that isn't an address
 * can't be trusted, so it falls back to `X-Real-IP`, then "unknown".
 */
export function clientIp(headers: Headers, trustedProxies: string[]): string {
  const trusted = new BlockList();
  for (const entry of trustedProxies) addTrusted(trusted, entry);
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const address of chain.reverse()) {
    const family = isIP(address);
    if (family === 0) break;
    if (!trusted.check(address, family === 6 ? "ipv6" : "ipv4")) return address;
  }
  const real = headers.get("x-real-ip")?.trim() ?? "";
  return isIP(real) === 0 ? "unknown" : real;
}
