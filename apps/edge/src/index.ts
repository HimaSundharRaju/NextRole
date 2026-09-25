import { Container, getContainer, getRandom } from "@cloudflare/containers";
import {
  canonicalRedirect,
  forwardToOrigin,
  httpsRedirect,
  instanceCount,
  JOBS_ENV_KEYS,
  pickEnv,
  WEB_ENV_KEYS,
} from "./forwarding";

export interface Env {
  WEB: DurableObjectNamespace<WebContainer>;
  JOBS: DurableObjectNamespace<JobsContainer>;
  /** How many web containers share the traffic (default 2). */
  WEB_INSTANCES?: string;
  /** "false" lets idle web containers sleep instead of being kept warm by the cron trigger. */
  KEEP_WARM?: string;
  /** App settings and secrets (wrangler vars and secrets), passed through to the containers. */
  [key: string]: unknown;
}

/** The Next.js server built from apps/web/Dockerfile. */
export class WebContainer extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = "15m";
  // Readiness probe; any response means the server is up.
  override pingEndpoint = "localhost/api/health";
  override envVars = pickEnv(this.env, WEB_ENV_KEYS);
}

/** The BullMQ worker built from apps/worker/Dockerfile: job-board sync, alerts, reminders. */
export class JobsContainer extends Container<Env> {
  override defaultPort = 8081;
  override sleepAfter = "10m";
  override pingEndpoint = "localhost/healthz";
  override envVars = pickEnv(this.env, JOBS_ENV_KEYS);

  // Its work is scheduled internally rather than arriving as requests, so it never idles out.
  override async onActivityExpired(): Promise<void> {
    this.renewActivityTimeout();
  }
}

const JOBS_INSTANCE = "jobs";

/** Starts the worker (after a deploy or restart) and keeps the web containers warm. */
async function keepAlive(env: Env): Promise<void> {
  const targets: Array<[string, Promise<Response>]> = [
    ["jobs", getContainer(env.JOBS, JOBS_INSTANCE).fetch("http://localhost/healthz")],
  ];
  if (env.KEEP_WARM !== "false") {
    for (let index = 0; index < instanceCount(env.WEB_INSTANCES); index++) {
      const name = `instance-${index}`;
      targets.push([name, getContainer(env.WEB, name).fetch("http://localhost/api/health")]);
    }
  }
  const results = await Promise.allSettled(targets.map(([, ping]) => ping));
  results.forEach((result, index) => {
    const name = targets[index]![0];
    if (result.status === "rejected") {
      console.error(`keep-alive: ${name} failed`, result.reason);
      return;
    }
    if (!result.value.ok) console.warn(`keep-alive: ${name} returned ${result.value.status}`);
    void result.value.body?.cancel();
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const redirect = canonicalRedirect(request, env.APP_URL) ?? httpsRedirect(request);
    if (redirect) return redirect;
    // The app keeps no state in memory (sessions live in Postgres), so any container can serve.
    const web = await getRandom(env.WEB, instanceCount(env.WEB_INSTANCES));
    return web.fetch(forwardToOrigin(request));
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(keepAlive(env));
  },
} satisfies ExportedHandler<Env>;
