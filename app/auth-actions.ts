"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, destroySession, getCurrentUser, requireUser, SESSION_COOKIE } from "@/lib/auth";
import { generateSessionToken, hashPassword, hashToken, verifyPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth-utils";
import { decideSignup, normalizeEmail, isValidEmail } from "@/lib/friends";
import { checkEmailSendIpThrottle, checkEmailSendThrottle, checkLoginLockout, checkSignupThrottle, clientIp, recordAttempt } from "@/lib/ratelimit";
import { getAppUrl, resetEmailHtml, sendEmail, verificationEmailHtml } from "@/lib/mail";
import { RESET_TTL_MS, tokenExpiry, tokenState, VERIFICATION_TTL_MS } from "@/lib/tokens";
import { capString, MAX_NAME_LEN } from "@/lib/validate";

function backTo(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

const GENERIC_LOGIN_ERROR = "Invalid email or password.";

/** Issue a fresh verification token (invalidating prior unused ones) and
 *  email the link. Returns the send result so callers can surface outages. */
async function sendVerificationEmail(userId: string, email: string) {
  await prisma.emailVerificationToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  const raw = generateSessionToken();
  await prisma.emailVerificationToken.create({
    data: { tokenHash: hashToken(raw), userId, expiresAt: tokenExpiry(VERIFICATION_TTL_MS) },
  });
  const link = `${getAppUrl()}/verify-email?token=${raw}`;
  return sendEmail({ to: email, subject: "Verify your OSS Splitwise email", html: verificationEmailHtml(link) });
}

async function sendResetEmail(userId: string, email: string) {
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  const raw = generateSessionToken();
  await prisma.passwordResetToken.create({
    data: { tokenHash: hashToken(raw), userId, expiresAt: tokenExpiry(RESET_TTL_MS) },
  });
  const link = `${getAppUrl()}/reset-password?token=${raw}`;
  return sendEmail({ to: email, subject: "Reset your OSS Splitwise password", html: resetEmailHtml(link) });
}

export async function signupAction(formData: FormData) {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const name = capString(formData.get("name"), MAX_NAME_LEN, "name");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  // Per-IP signup throttle (10/hour). Generic message — no details leaked.
  if (await checkSignupThrottle(ip)) {
    await recordAttempt("signup", email, ip, false);
    backTo("/signup", "Too many attempts. Please wait a while and try again.");
  }
  if (!name) backTo("/signup", "Please enter your name.");
  if (!isValidEmail(email)) backTo("/signup", "Please enter a valid email address.");
  if (password.length < MIN_PASSWORD_LENGTH) backTo("/signup", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);

  const existing = await prisma.user.findUnique({ where: { email } });
  const decision = decideSignup(existing ? { id: existing.id, email: existing.email, isPlaceholder: existing.isPlaceholder } : null);
  if (decision.kind === "duplicate-email") {
    // No user enumeration: never confirm that this email has an account.
    await recordAttempt("signup", email, ip, false);
    backTo("/signup", "We couldn't create an account with those details. If you already have an account, try logging in instead.");
  }
  const passwordHash = await hashPassword(password);
  let userId: string;
  if (decision.kind === "claim-placeholder") {
    // Claim the shadow account created when someone added this email as a
    // friend / group member: keep its expenses and friendships, attach the
    // real name + a NEW password. A placeholder has no sessions to inherit
    // (it could never log in), and any stray sessions are revoked anyway.
    await prisma.session.deleteMany({ where: { userId: decision.userId } });
    const claimed = await prisma.user.update({
      where: { id: decision.userId },
      data: { name, passwordHash, isPlaceholder: false },
    });
    userId = claimed.id;
  } else {
    const user = await prisma.user.create({ data: { name, email, passwordHash } });
    userId = user.id;
  }
  await recordAttempt("signup", email, ip, true);
  // The account starts UNVERIFIED and is NOT logged in. A verification link
  // is emailed; login stays blocked until the link is used, which is what
  // proves ownership of the email (this is also what makes placeholder
  // claiming safe: the claimer must control the invited inbox).
  const sent = await sendVerificationEmail(userId, email);
  if (!sent.ok) {
    backTo("/signup", "Your account was created, but the verification email couldn't be sent right now. Please contact support, or try the resend option on the login page later.");
  }
  redirect(`/login?notice=${encodeURIComponent("Account created — we emailed you a verification link. Verify your email, then log in.")}`);
}

export async function loginAction(formData: FormData) {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  // Lockout check BEFORE credential verification; the error stays generic so
  // the caller can't tell lockout apart from a wrong password.
  if (await checkLoginLockout(email)) {
    backTo("/login", GENERIC_LOGIN_ERROR);
  }
  const user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  // Placeholder accounts have no password and cannot log in until claimed.
  const ok = user && !user.isPlaceholder ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    await recordAttempt("login", email, ip, false);
    backTo("/login", GENERIC_LOGIN_ERROR);
  }
  // Password is correct at this point — only NOW may we reveal that the
  // account is unverified (revealing it earlier would be an oracle).
  if (!user.emailVerifiedAt) {
    redirect(`/login?error=${encodeURIComponent("Your email address isn't verified yet. We emailed you a verification link — click it, then log in. You can request a new link below.")}&unverified=1`);
  }
  await recordAttempt("login", email, ip, true); // success clears the failure counter
  await createSession(user.id); // always a FRESH session token (no fixation)
  redirect("/dashboard");
}

/** Resend the verification email. ALWAYS answers generically (no hint
 *  whether the email exists, is already verified, or was throttled). */
export async function resendVerificationAction(formData: FormData) {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const generic = `/login?notice=${encodeURIComponent("If an unverified account exists for that email, a new verification link is on its way.")}`;
  if (isValidEmail(email) && !(await checkEmailSendThrottle("verify_resend", email)) && !(await checkEmailSendIpThrottle("verify_resend", ip))) {
    const user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
    if (user && user.passwordHash && !user.emailVerifiedAt && !user.isPlaceholder) {
      await sendVerificationEmail(user.id, email);
      await recordAttempt("verify_resend", email, ip, true);
    }
  }
  redirect(generic);
}

/** Request a password-reset email. ALWAYS answers generically. */
export async function forgotPasswordAction(formData: FormData) {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const generic = `/forgot-password?notice=${encodeURIComponent("If an account exists for that email, a password reset link is on its way.")}`;
  if (isValidEmail(email) && !(await checkEmailSendThrottle("password_reset", email)) && !(await checkEmailSendIpThrottle("password_reset", ip))) {
    const user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
    if (user && user.passwordHash && !user.isPlaceholder) {
      await sendResetEmail(user.id, email);
      await recordAttempt("password_reset", email, ip, true);
    }
  }
  redirect(generic);
}

/** Consume a password-reset token: set the new password, mark the token
 *  used, and revoke ALL of the user's sessions. */
export async function resetPasswordAction(formData: FormData) {
  const raw = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const token = raw
    ? await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(raw) } }).catch(() => null)
    : null;
  if (tokenState(token) !== "valid" || !token) {
    redirect(`/reset-password?error=${encodeURIComponent("That reset link is invalid or has expired. Request a new one.")}`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirect(`/reset-password?token=${encodeURIComponent(raw)}&error=${encodeURIComponent(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)}`);
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: token.userId },
    // A completed reset also proves inbox ownership -> verify the email.
    data: { passwordHash, emailVerifiedAt: new Date() },
  });
  await prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
  await prisma.session.deleteMany({ where: { userId: token.userId } }); // revoke ALL sessions
  redirect(`/login?notice=${encodeURIComponent("Password updated. Please log in with your new password.")}`);
}

export async function logoutAction() {
  await destroySession(); // deletes the session row server-side + clears cookie
  redirect("/login");
}

/** Change password (Settings). Revokes ALL other sessions for the user. */
export async function changePasswordAction(formData: FormData) {
  const me = await requireUser();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const ok = await verifyPassword(current, me.passwordHash);
  if (!ok) redirect(`/settings?error=${encodeURIComponent("Current password is incorrect.")}`);
  if (next.length < MIN_PASSWORD_LENGTH) {
    redirect(`/settings?error=${encodeURIComponent(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`)}`);
  }
  const passwordHash = await hashPassword(next);
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash } });
  // Revoke every other session; keep only the current one alive.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await prisma.session.deleteMany({
    where: { userId: me.id, ...(token ? { NOT: { tokenHash: hashToken(token) } } : {}) },
  });
  redirect(`/settings?notice=${encodeURIComponent("Password changed. Your other sessions were signed out.")}`);
}

/** Used by /login and /signup pages to bounce already-authenticated users. */
export async function redirectIfAuthed() {
  if (await getCurrentUser()) redirect("/dashboard");
}
