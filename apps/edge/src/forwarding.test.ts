import { describe, expect, it } from "vitest";
import {
  canonicalRedirect,
  forwardToOrigin,
  httpsRedirect,
  instanceCount,
  JOBS_ENV_KEYS,
  pickEnv,
  WEB_ENV_KEYS,
} from "./forwarding";

describe("forwardToOrigin", () => {
  it("replaces client-supplied forwarding headers with Cloudflare's client IP", () => {
    const request = new Request("https://gettargetrole.example.com/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "10.0.0.1, 198.51.100.2",
        "x-real-ip": "10.0.0.1",
        cookie: "session=abc",
      },
      body: "{}",
    });
    const forwarded = forwardToOrigin(request);
    expect(forwarded.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(forwarded.headers.get("x-real-ip")).toBe("203.0.113.7");
    expect(forwarded.headers.get("x-forwarded-proto")).toBe("https");
    expect(forwarded.headers.get("x-forwarded-host")).toBe("gettargetrole.example.com");
    expect(forwarded.headers.get("cookie")).toBe("session=abc");
    expect(forwarded.method).toBe("POST");
    expect(forwarded.url).toBe(request.url);
  });

  it("drops spoofable headers when Cloudflare reports no client IP", () => {
    const forwarded = forwardToOrigin(
      new Request("https://gettargetrole.example.com/", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      }),
    );
    expect(forwarded.headers.has("x-forwarded-for")).toBe(false);
    expect(forwarded.headers.has("x-real-ip")).toBe(false);
  });
});

describe("canonicalRedirect", () => {
  const appUrl = "https://gettargetrole.hearthspace.in";

  it("sends other addresses to the same path on APP_URL", () => {
    for (const other of [
      "https://gettargetrole.acct.workers.dev/jobs?q=go",
      "https://old.example.com/jobs?q=go",
    ]) {
      const response = canonicalRedirect(new Request(other, { method: "POST" }), appUrl);
      expect(response?.status).toBe(308);
      expect(response?.headers.get("location")).toBe(
        "https://gettargetrole.hearthspace.in/jobs?q=go",
      );
    }
  });

  it("leaves APP_URL itself, local development and a missing APP_URL alone", () => {
    expect(canonicalRedirect(new Request(`${appUrl}/jobs`), appUrl)).toBeNull();
    expect(
      canonicalRedirect(new Request("http://gettargetrole.hearthspace.in/"), appUrl),
    ).toBeNull();
    expect(canonicalRedirect(new Request("http://localhost:8787/"), appUrl)).toBeNull();
    expect(canonicalRedirect(new Request("https://x.workers.dev/"), undefined)).toBeNull();
    expect(canonicalRedirect(new Request("https://x.workers.dev/"), "not a url")).toBeNull();
  });
});

describe("httpsRedirect", () => {
  it("sends plain-HTTP visits to HTTPS", () => {
    const response = httpsRedirect(new Request("http://gettargetrole.example.com/jobs?q=go"));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://gettargetrole.example.com/jobs?q=go");
  });

  it("leaves HTTPS and local development alone", () => {
    expect(httpsRedirect(new Request("https://gettargetrole.example.com/"))).toBeNull();
    expect(httpsRedirect(new Request("http://localhost:8787/"))).toBeNull();
  });
});

describe("pickEnv", () => {
  it("passes each container only the settings it reads", () => {
    const env = {
      WEB: {},
      DATABASE_URL: "postgres://db",
      ANTHROPIC_API_KEY: "sk-ant-test",
      BETTER_AUTH_SECRET: "secret",
      INGEST_CONCURRENCY: "4",
      SMTP_URL: "",
    };
    expect(pickEnv(env, WEB_ENV_KEYS)).toEqual({
      DATABASE_URL: "postgres://db",
      ANTHROPIC_API_KEY: "sk-ant-test",
      BETTER_AUTH_SECRET: "secret",
    });
    // The jobs container calls the AI for auto-prepare, but never sees auth secrets.
    expect(pickEnv(env, JOBS_ENV_KEYS)).toEqual({
      DATABASE_URL: "postgres://db",
      ANTHROPIC_API_KEY: "sk-ant-test",
      INGEST_CONCURRENCY: "4",
    });
  });
});

describe("instanceCount", () => {
  it("accepts 1-20 and falls back otherwise", () => {
    expect(instanceCount("3")).toBe(3);
    expect(instanceCount(undefined)).toBe(2);
    expect(instanceCount("0")).toBe(2);
    expect(instanceCount("many", 1)).toBe(1);
    expect(instanceCount("50")).toBe(2);
  });
});
