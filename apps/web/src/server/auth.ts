import "server-only";
import { getServerEnv } from "@gettargetrole/core/env";
import { createLogger } from "@gettargetrole/core/logger";
import { sendEmail } from "@gettargetrole/core/mailer";
import { getRedis } from "@gettargetrole/core/redis";
import { accounts, getDb, profiles, sessions, users, verifications } from "@gettargetrole/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { recordAudit } from "./audit";

const log = createLogger("auth");

// Fixed-window counter: increment, set the TTL on the first hit, and report the remaining TTL.
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}`;

/**
 * Distributed rate limiting for auth endpoints, shared by every app instance through Redis.
 * (Sessions deliberately stay in Postgres so user changes such as bans apply immediately.)
 */
function redisRateLimitStorage() {
  return {
    consume: async (key: string, rule: { window: number; max: number }) => {
      const [count, ttl] = (await getRedis().eval(
        CONSUME_SCRIPT,
        1,
        `ba:rl:${key}`,
        Math.max(1, Math.ceil(rule.window)),
      )) as [number, number];
      const allowed = count <= rule.max;
      return { allowed, retryAfter: allowed ? null : Math.max(1, ttl) };
    },
  };
}

function createAuth() {
  const env = getServerEnv();
  const baseURL = env.BETTER_AUTH_URL ?? env.APP_URL;
  const isProduction = env.NODE_ENV === "production";

  return betterAuth({
    appName: "GetTargetRole",
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        plan: { type: "string", required: false, input: false, defaultValue: "free" },
        onboardedAt: { type: "date", required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: isProduction,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your GetTargetRole password",
          text: `Hi ${user.name},\n\nReset your password here (link valid for 1 hour):\n${url}\n\nIf you didn't request this, you can ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: isProduction,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Verify your email for GetTargetRole",
          text: `Hi ${user.name},\n\nConfirm your email address to finish setting up GetTargetRole:\n${url}`,
        });
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {},
    rateLimit: {
      enabled: true,
      customStorage: redisRateLimitStorage(),
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 3600, max: 10 },
        "/request-password-reset": { window: 3600, max: 5 },
      },
    },
    advanced: {
      // A single-hop X-Forwarded-For is used as is; longer chains are resolved through
      // TRUSTED_PROXIES (the leftmost entry is client-controlled and never trusted).
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
        trustedProxies: env.TRUSTED_PROXIES,
      },
      useSecureCookies: baseURL.startsWith("https://"),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await getDb().insert(profiles).values({ userId: user.id }).onConflictDoNothing();
            await recordAudit({
              actorUserId: user.id,
              action: "auth.sign_up",
              targetType: "user",
              targetId: user.id,
            });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await recordAudit({
              actorUserId: session.userId,
              action: "auth.sign_in",
              targetType: "session",
              targetId: session.id,
              ipAddress: session.ipAddress ?? "",
              userAgent: session.userAgent ?? "",
            });
          },
        },
      },
    },
    plugins: [admin({ adminRoles: ["admin"], defaultRole: "user" }), nextCookies()],
    logger: {
      log: (level, message) => {
        if (level === "error") log.error(message);
        else if (level === "warn") log.warn(message);
        else log.debug(message);
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** Created lazily so importing this module never requires secrets (e.g. during `next build`). */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
