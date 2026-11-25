import { createHash, randomBytes } from "node:crypto";

/** The hash stored for a private link or export link; the token itself is never stored. */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new unguessable token (32 random bytes, base64url) and the hash to store for it. */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashLinkToken(token) };
}
