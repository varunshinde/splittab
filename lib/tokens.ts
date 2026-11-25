// Pure single-use email-token logic (verification + password reset).
// Raw tokens come from lib/auth-utils (generateSessionToken: 32-byte CSPRNG);
// only SHA-256 hashes are stored, exactly like session tokens.

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export type TokenState = "valid" | "used" | "expired" | "missing";

export interface TokenLike {
  expiresAt: Date;
  usedAt: Date | null;
}

export function tokenExpiry(ttlMs: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlMs);
}

/** A token is usable only if it exists, has never been used, and is unexpired. */
export function tokenState(token: TokenLike | null | undefined, now: Date = new Date()): TokenState {
  if (!token) return "missing";
  if (token.usedAt) return "used";
  if (token.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}
