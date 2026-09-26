import { publicOnly } from "./public-only";
import type { Fetcher } from "./types";

interface HostState {
  active: number;
  /** When the next request to this host may start. */
  nextStart: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps fetch so this process is a polite crawler: requests to one host run at most
 * `concurrency` at a time and start at most `perMinute` a minute, however many of that host's
 * boards are syncing. A 429 pauses the host for everyone until its Retry-After has passed.
 */
export function politeFetch(
  inner: Fetcher,
  { concurrency = 2, perMinute = 60 }: { concurrency?: number; perMinute?: number } = {},
): Fetcher {
  const gap = 60_000 / perMinute;
  const hosts = new Map<string, HostState>();

  async function acquire(host: string): Promise<HostState> {
    let state = hosts.get(host);
    if (!state) {
      state = { active: 0, nextStart: 0 };
      hosts.set(host, state);
    }
    for (;;) {
      const now = Date.now();
      if (state.active < concurrency && now >= state.nextStart) {
        state.active++;
        state.nextStart = now + gap;
        return state;
      }
      await sleep(Math.max(5, state.active < concurrency ? state.nextStart - now : 50));
    }
  }

  const wrapped = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const state = await acquire(new URL(url).host);
    try {
      const response = await inner(input, init);
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const pause = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 30_000;
        state.nextStart = Math.max(state.nextStart, Date.now() + pause);
      }
      return response;
    } finally {
      state.active--;
    }
  };
  return wrapped as Fetcher;
}

/**
 * The fetch every board request in this process goes through: limits shared across syncs, and
 * only public web addresses, since discovery follows links users submit.
 */
export const boardFetch: Fetcher = politeFetch(publicOnly((input, init) => fetch(input, init)));
