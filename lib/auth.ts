import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "./generated/prisma/client";
import { prisma } from "./db";
import { generateSessionToken, hashToken, isSessionDead, sessionExpiry, shouldTouchLastSeen } from "./auth-utils";

export const SESSION_COOKIE = "session";
export type { User };

/** Create a DB session for the user and set the httpOnly cookie. */
export async function createSession(userId: string): Promise<void> {
  const token = generateSessionToken();
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: sessionExpiry() },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

/** Resolve the current session cookie to a user, or null. Dead sessions
 *  (absolute 30-day expiry or 7-day idle expiry) are deleted lazily.
 *  lastSeenAt is refreshed on use, throttled to one write per hour.
 *  Placeholder users have no sessions (they cannot log in until claimed),
 *  but the isPlaceholder guard is belt-and-braces. */
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session
    .findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } })
    .catch(() => null);
  if (!session) return null;
  if (isSessionDead(session)) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.isPlaceholder) return null;
  if (shouldTouchLastSeen(session.lastSeenAt)) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session.user;
}

/** For pages/actions that require login: redirects to /login when absent. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Delete the current session (server-side) and clear the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => {});
  }
  store.delete(SESSION_COOKIE);
}
