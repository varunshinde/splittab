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

// Per-IP cap on top of the per-email one: one IP can trigger at most
// EMAIL_SEND_IP_MAX_PER_DAY sends of a kind per day, no matter how many
// distinct addresses it rotates through. The "unknown" IP (no proxy headers)
// is exempt — many unrelated users could share that bucket.
export const EMAIL_SEND_IP_MAX_PER_DAY = 20;

export function isEmailSendIpThrottled(attempts: AttemptLike[], now: Date = new Date()): boolean {
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  return attempts.filter((a) => a.createdAt.getTime() > dayAgo).length >= EMAIL_SEND_IP_MAX_PER_DAY;
}

export async function checkEmailSendIpThrottle(kind: string, ip: string): Promise<boolean> {
  if (ip === "unknown") return false;
  const attempts = await prisma.loginAttempt.findMany({
    where: { kind, ip, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: EMAIL_SEND_IP_MAX_PER_DAY,
  }).catch(() => []);
  return isEmailSendIpThrottled(attempts);
}

export async function checkLoginLockout(email: string, ip?: string): Promise<boolean> {
  // F4 residual (re-audit): the lockout is scoped to the (email, IP) PAIR.
  // Scoped to the email alone, anyone could keep a chosen victim locked
  // out forever with 5 bad guesses every 15 minutes from their own IP.
  // Pair-scoping means an attacker's failures lock out only the
  // attacker's IP for that account; the victim's own logins are
  // unaffected. The global per-IP failure cap still bounds spraying,
  // and a correct password from a new IP still faces the device-code
  // gate. The "unknown" IP (no proxy headers) falls back to email-only
  // scope, since unrelated users could share that bucket.
  const scoped = ip && ip !== "unknown" ? { ip } : {};
  const attempts = await prisma.loginAttempt.findMany({
    where: { kind: "login", email, ...scoped, createdAt: { gte: new Date(Date.now() - LOGIN_WINDOW_MS - LOGIN_LOCKOUT_MS) } },
    orderBy: { createdAt: "desc" },
    take: 50,
  }).catch(() => []);
  return isLockedOut(attempts);
}

// Per-IP login throttle: the per-email lockout alone lets one IP spray a
// single password across many accounts (never tripping any single account's
// lockout) or keep a victim's account perpetually locked. Cap FAILED logins
// per IP per hour; successes don't count, and the "unknown" bucket (no proxy
// headers) is exempt since unrelated users could share it.
export const LOGIN_IP_MAX_FAILURES_PER_HOUR = 30;
export const LOGIN_IP_WINDOW_MS = 60 * 60 * 1000;

export function isLoginIpThrottled(attempts: AttemptLike[], now: Date = new Date()): boolean {
  const since = now.getTime() - LOGIN_IP_WINDOW_MS;
  return attempts.filter((a) => !a.succeeded && a.createdAt.getTime() > since).length >= LOGIN_IP_MAX_FAILURES_PER_HOUR;
}

export async function checkLoginIpThrottle(ip: string): Promise<boolean> {
  if (ip === "unknown") return false;
  const attempts = await prisma.loginAttempt.findMany({
    where: { kind: "login", ip, succeeded: false, createdAt: { gte: new Date(Date.now() - LOGIN_IP_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    take: LOGIN_IP_MAX_FAILURES_PER_HOUR,
  }).catch(() => []);
  return isLoginIpThrottled(attempts);
}

export async function checkSignupThrottle(ip: string): Promise<boolean> {
  const attempts = await prisma.loginAttempt.findMany({
    where: { kind: "signup", ip, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 50,
  }).catch(() => []);
  return isSignupThrottled(attempts);
}

// --- Per-user action throttles (friend/group/invite actions, F3) -------------
// Recorded in LoginAttempt rows with kind = "action:<name>" and the acting
// user's email in the email column, so no new table is needed.
export const ACTION_LIMITS = {
  friend_add: { max: 20, windowMs: 60 * 60 * 1000 },
  group_create: { max: 10, windowMs: 24 * 60 * 60 * 1000 },
  group_member_add: { max: 30, windowMs: 60 * 60 * 1000 },
} as const;
export type ActionKind = keyof typeof ACTION_LIMITS;

export function isActionThrottled(kind: ActionKind, attempts: AttemptLike[], now: Date = new Date()): boolean {
  const { max, windowMs } = ACTION_LIMITS[kind];
  const since = now.getTime() - windowMs;
  return attempts.filter((a) => a.createdAt.getTime() > since).length >= max;
}

export async function checkActionThrottle(kind: ActionKind, userEmail: string): Promise<boolean> {
  const { max, windowMs } = ACTION_LIMITS[kind];
  const attempts = await prisma.loginAttempt.findMany({
    where: { kind: `action:${kind}`, email: userEmail, createdAt: { gte: new Date(Date.now() - windowMs) } },
    orderBy: { createdAt: "desc" },
    take: max,
  }).catch(() => []);
  return isActionThrottled(kind, attempts);
}

export async function recordAction(kind: ActionKind, userEmail: string, ip: string) {
  await recordAttempt(`action:${kind}`, userEmail, ip, true);
}

/** Best-effort client IP from proxy headers. NOTE: this trusts the left-most
 *  X-Forwarded-For value. That is safe on Vercel (the platform overwrites the
 *  header at the edge); behind a self-hosted proxy you must ensure the proxy
 *  sets it, or clients can spoof it to dodge per-IP limits (F4). */
export function clientIp(headersList: { get(name: string): string | null }): string {
  const xff = headersList.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 64);
  return (headersList.get("x-real-ip") ?? "unknown").slice(0, 64);
}
