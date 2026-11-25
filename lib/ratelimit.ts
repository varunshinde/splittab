import { prisma } from "./db";

// DB-backed login/signup throttling. The decision logic is pure and tested;
// the DB helpers just record attempts and fetch recent ones.

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // failures counted within 15 min
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // lockout lasts 15 min
export const SIGNUP_MAX_PER_IP_PER_HOUR = 10;

export interface AttemptLike {
  succeeded: boolean;
  createdAt: Date;
}

/**
 * Locked out when, within the trailing window, at least LOGIN_MAX_FAILURES
 * failures occurred with no success after them, and the most recent failure
 * is still inside the lockout period. A successful login clears the counter
 * (failures before the last success don't count).
 */
export function isLockedOut(attempts: AttemptLike[], now: Date = new Date()): boolean {
  const recent = attempts
    .filter((a) => now.getTime() - a.createdAt.getTime() <= LOGIN_WINDOW_MS + LOGIN_LOCKOUT_MS)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  let failures = 0;
  let lastFailureAt: number | null = null;
  for (const a of recent) {
    if (a.succeeded) break; // counter cleared by the latest success
    failures += 1;
    if (lastFailureAt === null) lastFailureAt = a.createdAt.getTime();
  }
  if (failures < LOGIN_MAX_FAILURES || lastFailureAt === null) return false;
  return now.getTime() - lastFailureAt < LOGIN_LOCKOUT_MS;
}

/** Pure signup throttle: too many attempts from one IP in the last hour. */
export function isSignupThrottled(attempts: AttemptLike[], now: Date = new Date()): boolean {
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  return attempts.filter((a) => a.createdAt.getTime() > hourAgo).length >= SIGNUP_MAX_PER_IP_PER_HOUR;
}

export async function recordAttempt(kind: string, email: string, ip: string, succeeded: boolean) {
  await prisma.loginAttempt.create({ data: { kind, email, ip, succeeded } }).catch(() => {});
}

// --- Email-send throttling (verification resend + password reset) -----------
// Max 1 send per minute and 5 sends per day, per email address. Tracked with
// the same LoginAttempt rows (kind = "verify_resend" | "password_reset").
export const EMAIL_SEND_MIN_INTERVAL_MS = 60 * 1000;
export const EMAIL_SEND_MAX_PER_DAY = 5;

export function isEmailSendThrottled(attempts: AttemptLike[], now: Date = new Date()): boolean {
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const recent = attempts.filter((a) => a.createdAt.getTime() > dayAgo)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (recent.length >= EMAIL_SEND_MAX_PER_DAY) return true;
  if (recent.length > 0 && now.getTime() - recent[0].createdAt.getTime() < EMAIL_SEND_MIN_INTERVAL_MS) return true;
  return false;
}

export async function checkEmailSendThrottle(kind: string, email: string): Promise<boolean> {
  const attempts = await prisma.loginAttempt.findMany({
    where: { kind, email, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 20,
  }).catch(() => []);
  return isEmailSendThrottled(attempts);
}

export async function checkLoginLockout(email: string): Promise<boolean> {
  const attempts = await prisma.loginAttempt.findMany({
    where: { kind: "login", email, createdAt: { gte: new Date(Date.now() - LOGIN_WINDOW_MS - LOGIN_LOCKOUT_MS) } },
    orderBy: { createdAt: "desc" },
    take: 50,
  }).catch(() => []);
  return isLockedOut(attempts);
}

export async function checkSignupThrottle(ip: string): Promise<boolean> {
  const attempts = await prisma.loginAttempt.findMany({
    where: { kind: "signup", ip, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 50,
  }).catch(() => []);
  return isSignupThrottled(attempts);
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headersList: { get(name: string): string | null }): string {
  const xff = headersList.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 64);
  return (headersList.get("x-real-ip") ?? "unknown").slice(0, 64);
}
