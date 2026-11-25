"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, destroySession, getCurrentUser, requireUser, SESSION_COOKIE } from "@/lib/auth";
import { DUMMY_PASSWORD_HASH, generateSessionToken, hashPassword, hashToken, validateNewPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth-utils";
import { decideSignup, normalizeEmail, isValidEmail } from "@/lib/friends";
import { checkEmailSendIpThrottle, checkEmailSendThrottle, checkLoginIpThrottle, checkLoginLockout, checkSignupThrottle, clientIp, recordAttempt } from "@/lib/ratelimit";
import { deviceCodeEmailHtml, existingAccountEmailHtml, getAppUrl, newSigninAlertEmailHtml, resetEmailHtml, sendEmail, verificationEmailHtml, type SigninContext } from "@/lib/mail";
import {
  challengeState, describeDevice, deviceHashFor, generateLoginCode, hashLoginCode, locationChanged,
  locationLabel, loginCodeMatches, parseGeo, DEVICE_CHALLENGE_COOKIE, LOGIN_CODE_TTL_MS,
} from "@/lib/device";
import { RESET_TTL_MS, tokenExpiry, tokenState, VERIFICATION_TTL_MS } from "@/lib/tokens";
import { capString, MAX_NAME_LEN } from "@/lib/validate";

function backTo(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

/** Run a task after the response is sent (Next `after()`), so response
 *  timing doesn't reveal whether an email was actually dispatched (F3).
 *  Outside a request scope (unit tests) `after` throws — fall back to
 *  running inline so behavior stays testable and deterministic there. */
async function inBackground(task: () => Promise<unknown>) {
  try {
    const { after } = await import("next/server");
    after(task);
  } catch {
    await task().catch(() => {});
  }
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
  return sendEmail({ to: email, subject: "Verify your SplitTab email", html: verificationEmailHtml(link) });
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
  return sendEmail({ to: email, subject: "Reset your SplitTab password", html: resetEmailHtml(link) });
}

export async function signupAction(formData: FormData) {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const name = capString(formData.get("name"), MAX_NAME_LEN, "name");
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  // Per-IP signup throttle (10/hour). Generic message — no details leaked.
  if (await checkSignupThrottle(ip)) {
    await recordAttempt("signup", email, ip, false);
    backTo("/signup", "Too many attempts. Please wait a while and try again.");
  }
  if (!name) backTo("/signup", "Please enter your name.");
  if (!isValidEmail(email)) backTo("/signup", "Please enter a valid email address.");

  // F2: NO password is collected at signup. A password set before the email
  // is verified enables account pre-hijack (attacker signs up with the
  // victim's email + attacker's password; victim's verification click arms
  // it). Instead the emailed link lands on a set-password page, and the
  // password is only stored when the inbox owner completes that step.
  const existing = await prisma.user.findUnique({ where: { email } });
  const decision = decideSignup(existing ? { id: existing.id, email: existing.email, isPlaceholder: existing.isPlaceholder } : null);
  // Every non-throttled path lands on the SAME generic outcome (F3): the
  // response never reveals whether the email was new, a placeholder claim,
  // or an already-registered account.
  const done = `/login?notice=${encodeURIComponent("Check your email — we sent you a link to finish setting up your account. If you already have an account, you can just log in.")}`;
  if (decision.kind === "duplicate-email") {
    // Already registered: create nothing, change nothing. The owner gets a
    // notice email (which doubles as an alert if it wasn't them).
    await recordAttempt("signup", email, ip, false);
    await sendEmail({ to: email, subject: "Your SplitTab account", html: existingAccountEmailHtml() });
    redirect(done);
  }
  let userId: string;
  if (decision.kind === "claim-placeholder") {
    // Do NOT flip isPlaceholder or set anything yet: the placeholder is only
    // claimed when the set-password step completes (see completeSignup).
    userId = decision.userId;
  } else {
    const user = await prisma.user.create({ data: { name, email } });
    userId = user.id;
  }
  await recordAttempt("signup", email, ip, true);
  const sent = await sendVerificationEmail(userId, email);
  if (!sent.ok) {
    backTo("/signup", "We couldn't send the setup email right now. Please try the resend option on the login page in a few minutes.");
  }
  redirect(done);
}

/** Complete a signup: the emailed link's landing step. Sets the password,
 *  marks the email verified and (for invited placeholders) claims the
 *  account — all only now, when inbox ownership is proven. The token is
 *  consumed ATOMICALLY (F9): updateMany with usedAt still null, so two
 *  concurrent submissions can't both succeed. */
export async function completeSignupAction(formData: FormData) {
  const raw = String(formData.get("token") ?? "");
  const name = capString(formData.get("name"), MAX_NAME_LEN, "name");
  const password = String(formData.get("password") ?? "");
  const back = (error: string): never =>
    redirect(`/verify-email?token=${encodeURIComponent(raw)}&error=${encodeURIComponent(error)}`);
  const token = raw
    ? await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(raw) } }).catch(() => null)
    : null;
  if (!token || tokenState(token) !== "valid") {
    redirect(`/login?error=${encodeURIComponent("That setup link is invalid or has expired. Log in to request a new one.")}`);
  }
  if (!name) back("Please enter your name.");
  const pwError = validateNewPassword(password);
  if (pwError) back(pwError);
  const consumed = await prisma.emailVerificationToken.updateMany({
    where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) {
    redirect(`/login?error=${encodeURIComponent("That setup link is invalid or has expired. Log in to request a new one.")}`);
  }
  const passwordHash = await hashPassword(password);
  await prisma.session.deleteMany({ where: { userId: token.userId } });
  await prisma.user.update({
    where: { id: token.userId },
    data: { name, passwordHash, emailVerifiedAt: new Date(), isPlaceholder: false },
  });
  redirect(`/login?notice=${encodeURIComponent("Your account is ready — log in with your new password.")}`);
}

function signinContext(userAgent: string, geo: { city: string; region: string; country: string }, ip: string): SigninContext {
  return { deviceLabel: describeDevice(userAgent), location: locationLabel(geo), ip, when: new Date().toUTCString() };
}

export async function loginAction(formData: FormData) {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  // Per-IP throttle first (stops password spraying across accounts), then
  // the per-email lockout. Both answer with the same generic error.
  if (await checkLoginIpThrottle(ip)) {
    await recordAttempt("login", email, ip, false);
    backTo("/login", GENERIC_LOGIN_ERROR);
  }
  // Lockout check BEFORE credential verification; the error stays generic so
  // the caller can't tell lockout apart from a wrong password.
  if (await checkLoginLockout(email)) {
    backTo("/login", GENERIC_LOGIN_ERROR);
  }
  const user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  // Placeholder accounts have no password and cannot log in until claimed.
  // Unknown / passwordless accounts still run a bcrypt compare against a
  // dummy hash, so login timing doesn't reveal whether the email exists (F3).
  const ok = user && !user.isPlaceholder && user.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_PASSWORD_HASH).then(() => false);
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
  // --- Device gate ---------------------------------------------------------
  // Trusted device: proceed, but alert by email if the location changed.
  // Untrusted device: NO session yet — email a 6-digit code; the session is
  // created only by verifyDeviceAction after the code checks out.
  const ua = hdrs.get("user-agent") ?? "";
  const geo = parseGeo(hdrs);
  const dHash = deviceHashFor(ua);
  const trusted = await prisma.trustedDevice
    .findUnique({ where: { userId_deviceHash: { userId: user.id, deviceHash: dHash } } })
    .catch(() => null);
  if (trusted) {
    const prev = { city: trusted.city, region: trusted.region, country: trusted.country };
    await prisma.trustedDevice.update({
      where: { id: trusted.id },
      data: { lastSeenAt: new Date(), ipAddress: ip, city: geo.city, region: geo.region, country: geo.country },
    }).catch(() => {});
    if (locationChanged(prev, geo)) {
      await inBackground(() => sendEmail({
        to: user.email,
        subject: "SplitTab sign-in from a new location",
        html: newSigninAlertEmailHtml("location", signinContext(ua, geo, ip)),
      }));
    }
    await createSession(user.id); // always a FRESH session token (no fixation)
    redirect("/dashboard");
  }
  if ((await checkEmailSendThrottle("device_code", email)) || (await checkEmailSendIpThrottle("device_code", ip))) {
    backTo("/login", GENERIC_LOGIN_ERROR);
  }
  await prisma.loginChallenge.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  const code = generateLoginCode();
  const challenge = await prisma.loginChallenge.create({
    data: {
      userId: user.id, codeHash: hashLoginCode(code), deviceHash: dHash,
      userAgent: ua.slice(0, 300), ipAddress: ip,
      city: geo.city, region: geo.region, country: geo.country,
      expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS),
    },
  });
  const sent = await sendEmail({
    to: user.email,
    subject: "Your SplitTab sign-in code",
    html: deviceCodeEmailHtml(code, signinContext(ua, geo, ip)),
  });
  if (!sent.ok) {
    backTo("/login", "We couldn't email your sign-in code right now. Please try again in a few minutes.");
  }
  await recordAttempt("device_code", email, ip, true);
  (await cookies()).set(DEVICE_CHALLENGE_COOKIE, challenge.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LOGIN_CODE_TTL_MS / 1000,
  });
  redirect("/verify-device");
}

/** Second step of a new-device login: check the emailed code. On success
 *  the device becomes trusted (unless the user opted out), a "new device"
 *  alert email is sent, and the session is created. */
export async function verifyDeviceAction(formData: FormData) {
  const store = await cookies();
  const challengeId = store.get(DEVICE_CHALLENGE_COOKIE)?.value;
  const code = String(formData.get("code") ?? "");
  const trust = formData.get("trust") !== null;
  const expired = `/login?error=${encodeURIComponent("That sign-in code is invalid or has expired. Please log in again.")}`;
  if (!challengeId) redirect(expired);
  const challenge = await prisma.loginChallenge
    .findUnique({ where: { id: challengeId }, include: { user: true } })
    .catch(() => null);
  if (!challenge || challengeState(challenge) !== "valid") {
    store.delete(DEVICE_CHALLENGE_COOKIE);
    redirect(expired);
  }
  if (!loginCodeMatches(code, challenge.codeHash)) {
    await prisma.loginChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    redirect(`/verify-device?error=${encodeURIComponent("That code doesn't match. Check the email and try again.")}`);
  }
  const consumed = await prisma.loginChallenge.updateMany({
    where: { id: challenge.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) redirect(expired);
  store.delete(DEVICE_CHALLENGE_COOKIE);
  if (trust) {
    await prisma.trustedDevice.upsert({
      where: { userId_deviceHash: { userId: challenge.userId, deviceHash: challenge.deviceHash } },
      create: {
        userId: challenge.userId, deviceHash: challenge.deviceHash, userAgent: challenge.userAgent,
        ipAddress: challenge.ipAddress, city: challenge.city, region: challenge.region, country: challenge.country,
      },
      update: { lastSeenAt: new Date(), ipAddress: challenge.ipAddress, city: challenge.city, region: challenge.region, country: challenge.country },
    });
  }
  const geo = { city: challenge.city, region: challenge.region, country: challenge.country };
  await inBackground(() => sendEmail({
    to: challenge.user.email,
    subject: "New device signed in to SplitTab",
    html: newSigninAlertEmailHtml("device", signinContext(challenge.userAgent, geo, challenge.ipAddress)),
  }));
  await createSession(challenge.userId);
  redirect("/dashboard");
}

/** Settings: forget a trusted device. Its next login will need a code. */
export async function revokeTrustedDeviceAction(formData: FormData) {
  const me = await requireUser();
  const deviceId = String(formData.get("deviceId") ?? "");
  await prisma.trustedDevice.deleteMany({ where: { id: deviceId, userId: me.id } });
  redirect(`/settings?notice=${encodeURIComponent("Device removed. It will need a sign-in code next time it logs in.")}`);
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
    if (user && !user.emailVerifiedAt && !user.isPlaceholder) {
      await recordAttempt("verify_resend", email, ip, true);
      await inBackground(() => sendVerificationEmail(user.id, email));
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
    if (user && !user.isPlaceholder) {
      await recordAttempt("password_reset", email, ip, true);
      await inBackground(() => sendResetEmail(user.id, email));
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
  const pwError = validateNewPassword(password);
  if (pwError) {
    redirect(`/reset-password?token=${encodeURIComponent(raw)}&error=${encodeURIComponent(pwError)}`);
  }
  // Consume ATOMICALLY (F9): only the request that flips usedAt from null
  // proceeds; a concurrent replay loses the race and changes nothing.
  const consumed = await prisma.passwordResetToken.updateMany({
    where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) {
    redirect(`/reset-password?error=${encodeURIComponent("That reset link is invalid or has expired. Request a new one.")}`);
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: token.userId },
    // A completed reset also proves inbox ownership -> verify the email.
    data: { passwordHash, emailVerifiedAt: new Date(), isPlaceholder: false },
  });
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
  const nextError = validateNewPassword(next);
  if (nextError) {
    redirect(`/settings?error=${encodeURIComponent(nextError.replace(/^Password/, "New password"))}`);
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
