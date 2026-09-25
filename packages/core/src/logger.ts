import { pino, type Logger } from "pino";

// Anything that could carry credentials or personal data is masked before it reaches log sinks.
const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "apiKey",
  "*.apiKey",
  "authorization",
  "*.authorization",
  "headers.authorization",
  "headers.cookie",
  "cookie",
  "*.cookie",
  "email",
  "*.email",
  "resumeText",
  "*.resumeText",
];

const rootLogger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  base: { app: "nextrole" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type { Logger };

export function createLogger(service: string, bindings: Record<string, unknown> = {}): Logger {
  return rootLogger.child({ service, ...bindings });
}

export const logger = rootLogger;
