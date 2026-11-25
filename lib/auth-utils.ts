import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";

// Pure auth primitives (no DB, no cookies) so they can be unit-tested and
// reused from server actions, route handlers and scripts alike.

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (absolute)
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (idle)
export const MIN_PASSWORD_LENGTH = 10;
const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

/** 32 random bytes, base64url-encoded (43 chars). This raw token is what goes
 *  into the httpOnly cookie; it is never stored server-side. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of a session token — the only form persisted in the DB. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

export function isSessionExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** A session is dead if it passed its absolute expiry OR has been idle
 *  longer than the idle window. */
export function isSessionDead(session: { expiresAt: Date; lastSeenAt: Date }, now: Date = new Date()): boolean {
  if (isSessionExpired(session.expiresAt, now)) return true;
  return now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_MS;
}

/** Throttle lastSeenAt writes: only persist if the stored value is >1h old. */
export function shouldTouchLastSeen(lastSeenAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() > 60 * 60 * 1000;
}
