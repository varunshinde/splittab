"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, destroySession, getCurrentUser, requireUser, SESSION_COOKIE } from "@/lib/auth";
import { DUMMY_PASSWORD_HASH, generateSessionToken, hashPassword, hashToken, validateNewPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth-utils";
import { decideSignup, normalizeEmail, isValidEmail } from "@/lib/friends";
import { checkEmailSendIpThrottle, checkEmailSendThrottle, checkLoginEmailBackstop, checkLoginIpThrottle, checkLoginLockout, checkSettingsPwLockout, checkSignupThrottle, clientIp, recordAttempt } from "@/lib/ratelimit";
import { deviceCodeEmailHtml, existingAccountEmailHtml, getAppUrl, newSigninAlertEmailHtml, resetEmailHtml, sendEmail, verificationEmailHtml, type SigninContext } from "@/lib/mail";
import {
  challengeState, describeDevice, deviceTrustExpiry, generateDeviceToken, generateLoginCode, hashDeviceToken, hashLoginCode, locationChanged,
  locationLabel, loginCodeMatches, parseGeo, DEVICE_CHALLENGE_COOKIE, DEVICE_TOKEN_COOKIE, DEVICE_TOKEN_MAX_AGE_S, LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODE_TTL_MS,
} from "@/lib/device";
import { flashUrl, passwordFlashCode, type FlashCode } from "@/lib/flash";
import { RESET_TTL_MS, tokenExpiry, tokenState, VERIFICATION_TTL_MS } from "@/lib/tokens";
import { capString, MAX_NAME_LEN } from "@/lib/validate";

function backTo(path: string, code: FlashCode): never {
  redirect(flashUrl(path, "error", code));
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
    backTo("/signup", "too_many_attempts");
  }
  if (!name) backTo("/signup", "name_required");
  if (!isValidEmail(email)) backTo("/signup", "invalid_email");

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
  const done = flashUrl("/login", "notice", "signup_check_email");
  // N7: per-EMAIL send cap for signup mail (same 1/min + 5/day as resend).
  // The old code only throttled per IP, so rotating IPs could flood one
  // victim's inbox with signup emails. When throttled we silently skip
  // the send — the outward response stays the generic `done`.
  const signupMailThrottled =
    (await checkEmailSendThrottle("verify_signup", email)) || (await checkEmailSendIpThrottle("verify_signup", ip));
  if (decision.kind === "duplicate-email") {
    // Already registered: create nothing, change nothing. The owner gets a
    // notice email (which doubles as an alert if it wasn't them).
    await recordAttempt("signup", email, ip, false);
    if (!signupMailThrottled) {
      await sendEmail({ to: email, subject: "Your SplitTab account", html: existingAccountEmailHtml() });
      await recordAttempt("verify_signup", email, ip, true);
    }
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
  if (signupMailThrottled) {
    // Account row exists (or is a placeholder claim) but this email has
    // hit its send cap — no email goes out, same generic outcome. The
    // owner can still use the resend link on the login page later.
    redirect(done);
  }
  const sent = await sendVerificationEmail(userId, email);
  if (!sent.ok) {
    backTo("/signup", "signup_send_failed");
  }
  await recordAttempt("verify_signup", email, ip, true);
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
  const back = (code: FlashCode): never =>
    redirect(flashUrl(`/verify-email?token=${encodeURIComponent(raw)}`, "error", code));
  const token = raw
    ? await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(raw) } }).catch(() => null)
    : null;
  if (!token || tokenState(token) !== "valid") {
    redirect(flashUrl("/login", "error", "setup_link_invalid"));
  }
  if (!name) back("name_required");
  const pwError = validateNewPassword(password);
  if (pwError) back(passwordFlashCode(pwError));
  const consumed = await prisma.emailVerificationToken.updateMany({
    where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) {
    redirect(flashUrl("/login", "error", "setup_link_invalid"));
  }
  const passwordHash = await hashPassword(password);
  await prisma.session.deleteMany({ where: { userId: token.userId } });
  await prisma.user.update({
    where: { id: token.userId },
    data: { name, passwordHash, emailVerifiedAt: new Date(), isPlaceholder: false },
  });
  redirect(flashUrl("/login", "notice", "account_ready"));
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
  // the per-(email, IP) lockout. Both answer with the same generic error.
  if (await checkLoginIpThrottle(ip)) {
    await recordAttempt("login", email, ip, false);
    backTo("/login", "invalid_credentials");
  }
  // Lockout check BEFORE credential verification; the error stays generic so
  // the caller can't tell lockout apart from a wrong password.
  if (await checkLoginLockout(email, ip)) {
    backTo("/login", "invalid_credentials");
  }
  // R4: IP-independent backstop — rotating or spoofed IPs cannot walk
  // around this one.
  if (await checkLoginEmailBackstop(email)) {
    backTo("/login", "invalid_credentials");
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
    backTo("/login", "invalid_credentials");
  }
  // Password is correct at this point — only NOW may we reveal that the
  // account is unverified (revealing it earlier would be an oracle).
  if (!user.emailVerifiedAt) {
    redirect(flashUrl("/login", "error", "unverified", "&unverified=1"));
  }
  await recordAttempt("login", email, ip, true); // success clears the failure counter
  // --- Device gate (N1) -----------------------------------------------------
  // Trust is proven by the random device token in the httpOnly
  // `device_token` cookie (only its hash is stored), NEVER by the
  // User-Agent — a UA is public and shared by millions of browsers.
  // Trusted device: proceed, but alert by email if the location changed.
  // Untrusted device: NO session yet — email a 6-digit code; the session is
  // created only by verifyDeviceAction after the code checks out.
  const ua = hdrs.get("user-agent") ?? "";
  const geo = parseGeo(hdrs);
  const deviceToken = (await cookies()).get(DEVICE_TOKEN_COOKIE)?.value;
  const trusted = deviceToken
    ? await prisma.trustedDevice
        .findUnique({ where: { tokenHash: hashDeviceToken(deviceToken) } })
        // R9: an expired trust row is no trust at all, however fresh the
        // cookie looks.
        .then((d) => (d && d.userId === user.id && d.expiresAt > new Date() ? d : null))
        .catch(() => null)
    : null;
  if (trusted) {
    const prev = { city: trusted.city, region: trusted.region, country: trusted.country };
    await prisma.trustedDevice.update({
      where: { id: trusted.id },
      // R9: sliding expiry — using the device renews its 90 days.
      data: { lastSeenAt: new Date(), expiresAt: deviceTrustExpiry(), ipAddress: ip, city: geo.city, region: geo.region, country: geo.country },
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
    backTo("/login", "invalid_credentials");
  }
  await prisma.loginChallenge.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  const code = generateLoginCode();
  const challenge = await prisma.loginChallenge.create({
    data: {
      userId: user.id, codeHash: hashLoginCode(code),
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
    backTo("/login", "code_send_failed");
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
  const expired = flashUrl("/login", "error", "signin_code_invalid");
  if (!challengeId) redirect(expired);
  const challenge = await prisma.loginChallenge
    .findUnique({ where: { id: challengeId }, include: { user: true } })
    .catch(() => null);
  if (!challenge || challengeState(challenge) === "missing" || challenge.usedAt) {
    store.delete(DEVICE_CHALLENGE_COOKIE);
    redirect(expired);
  }
  // N8: claim the attempt ATOMICALLY before comparing — the old
  // read-then-increment let parallel guesses all pass the attempts<5
  // check. Only the request that increments within the cap proceeds.
  const claimed = await prisma.loginChallenge.updateMany({
    where: { id: challenge.id, usedAt: null, attempts: { lt: LOGIN_CODE_MAX_ATTEMPTS }, expiresAt: { gt: new Date() } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    store.delete(DEVICE_CHALLENGE_COOKIE);
    redirect(expired);
  }
  if (!loginCodeMatches(code, challenge.codeHash)) {
    redirect(flashUrl("/verify-device", "error", "code_mismatch"));
  }
  const consumed = await prisma.loginChallenge.updateMany({
    where: { id: challenge.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) redirect(expired);
  store.delete(DEVICE_CHALLENGE_COOKIE);
  if (trust) {
    // Issue a fresh random device token (N1): the cookie carries the raw
    // token, the database only its SHA-256 hash. The User-Agent below is
    // just the Settings display label.
    const deviceToken = generateDeviceToken();
    await prisma.trustedDevice.create({
      data: {
        userId: challenge.userId, tokenHash: hashDeviceToken(deviceToken), userAgent: challenge.userAgent,
        ipAddress: challenge.ipAddress, city: challenge.city, region: challenge.region, country: challenge.country,
        // R9: server-side expiry (90 days, sliding) — see lib/device-trust.
        expiresAt: deviceTrustExpiry(),
      },
    });
    store.set(DEVICE_TOKEN_COOKIE, deviceToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: DEVICE_TOKEN_MAX_AGE_S,
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
  const target = await prisma.trustedDevice.findFirst({ where: { id: deviceId, userId: me.id }, select: { tokenHash: true } });
  await prisma.trustedDevice.deleteMany({ where: { id: deviceId, userId: me.id } });
  // Revoking the device you're on also clears its trust cookie.
  const store = await cookies();
  const current = store.get(DEVICE_TOKEN_COOKIE)?.value;
  if (target && current && hashDeviceToken(current) === target.tokenHash) {
    store.delete(DEVICE_TOKEN_COOKIE);
  }
  redirect(flashUrl("/settings", "notice", "device_removed"));
}

/** Resend the verification email. ALWAYS answers generically (no hint
 *  whether the email exists, is already verified, or was throttled). */
export async function resendVerificationAction(formData: FormData) {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const generic = flashUrl("/login", "notice", "resend_generic");
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
  const generic = flashUrl("/forgot-password", "notice", "reset_generic");
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
    redirect(flashUrl("/reset-password", "error", "reset_link_invalid"));
  }
  const pwError = validateNewPassword(password);
  if (pwError) {
    redirect(flashUrl(`/reset-password?token=${encodeURIComponent(raw)}`, "error", passwordFlashCode(pwError)));
  }
  // Consume ATOMICALLY (F9): only the request that flips usedAt from null
  // proceeds; a concurrent replay loses the race and changes nothing.
  const consumed = await prisma.passwordResetToken.updateMany({
    where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) {
    redirect(flashUrl("/reset-password", "error", "reset_link_invalid"));
  }
  const passwordHash = await hashPassword(password);
  // N7: an account whose passwordHash is still null was never actually
  // claimed — its display name may have been chosen by whoever submitted
  // the signup form (possibly not the owner). Treat it like a placeholder:
  // when the inbox owner sets their first password via this reset, let
  // them set the name too instead of inheriting the squatted one.
  const prior = await prisma.user.findUnique({ where: { id: token.userId }, select: { passwordHash: true } });
  const firstPassword = !prior?.passwordHash;
  const chosenName = firstPassword ? capString(formData.get("name"), MAX_NAME_LEN, "name") : null;
  await prisma.user.update({
    where: { id: token.userId },
    // A completed reset also proves inbox ownership -> verify the email.
    data: { passwordHash, emailVerifiedAt: new Date(), isPlaceholder: false, ...(chosenName ? { name: chosenName } : {}) },
  });
  await prisma.session.deleteMany({ where: { userId: token.userId } }); // revoke ALL sessions
  // N1: a password reset also un-trusts every device — the reset may be
  // happening precisely because the account was compromised.
  await prisma.trustedDevice.deleteMany({ where: { userId: token.userId } });
  await prisma.loginChallenge.deleteMany({ where: { userId: token.userId, usedAt: null } });
  redirect(flashUrl("/login", "notice", "password_updated"));
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
  // R8: throttle current-password guesses in Settings like logins.
  const ip = clientIp(await headers());
  if (await checkSettingsPwLockout(me.email)) {
    redirect(flashUrl("/settings", "error", "too_many_attempts"));
  }
  const ok = await verifyPassword(current, me.passwordHash);
  await recordAttempt("settings_pw", me.email, ip, ok);
  if (!ok) redirect(flashUrl("/settings", "error", "current_password_wrong"));
  const nextError = validateNewPassword(next);
  if (nextError) {
    redirect(flashUrl("/settings", "error", passwordFlashCode(nextError, "new_pw")));
  }
  const passwordHash = await hashPassword(next);
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash } });
  // Revoke every other session; keep only the current one alive.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await prisma.session.deleteMany({
    where: { userId: me.id, ...(token ? { NOT: { tokenHash: hashToken(token) } } : {}) },
  });
  // N1: un-trust every device on password change, including this one —
  // the next login everywhere goes through the email-code challenge again.
  await prisma.trustedDevice.deleteMany({ where: { userId: me.id } });
  (await cookies()).delete(DEVICE_TOKEN_COOKIE);
  redirect(flashUrl("/settings", "notice", "password_changed"));
}

/** Used by /login and /signup pages to bounce already-authenticated users. */
export async function redirectIfAuthed() {
  if (await getCurrentUser()) redirect("/dashboard");
}

/** Delete the signed-in account (F12). The row is tombstoned rather than
 *  hard-deleted: expenses this user paid for are part of OTHER users'
 *  ledgers (Expense.paidBy has no cascade), so the record stays as an
 *  anonymized "Deleted user" while identity, credentials, sessions,
 *  trusted devices and pending challenges are wiped — the account can
 *  never be logged into again, and the email address is freed. */
export async function deleteAccountAction(formData: FormData) {
  const user = await requireUser();
  const current = String(formData.get("current_password") ?? "");
  // R8: same throttle as change-password — deletion is the most
  // destructive guess target in Settings.
  const ip = clientIp(await headers());
  if (await checkSettingsPwLockout(user.email)) {
    redirect(flashUrl("/settings", "error", "too_many_attempts"));
  }
  const pwOk = !!user.passwordHash && (await verifyPassword(current, user.passwordHash));
  await recordAttempt("settings_pw", user.email, ip, pwOk);
  if (!pwOk) {
    redirect(flashUrl("/settings", "error", "current_password_wrong"));
  }
  await prisma.trustedDevice.deleteMany({ where: { userId: user.id } });
  await prisma.loginChallenge.deleteMany({ where: { userId: user.id } });
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  // R1: NO global find-and-replace of the user's name in activity text —
  // the old scrub rewrote OTHER people's messages across the whole
  // database whenever the name appeared as a substring ("Al" inside
  // "also", a user literally named "voided by"). Activity written since
  // R1 stores ids, not names, and renders from the tombstoned row, so
  // the leaver reads as "Deleted user" everywhere automatically. For
  // legacy rows, neutralize only the messages the leaver AUTHORED
  // (their own text can name other people); everyone else's records of
  // shared history are their own and stay untouched.
  await prisma.activity.updateMany({
    where: { userId: user.id },
    data: { message: "Activity by a deleted user" },
  }).catch(() => {});
  await prisma.loginAttempt.deleteMany({ where: { email: user.email } }).catch(() => {});
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: "Deleted user",
      email: `deleted-${user.id}@deleted.splittab.invalid`,
      passwordHash: null,
      emailVerifiedAt: null,
      isPlaceholder: true,
    },
  });
  await destroySession();
  redirect(flashUrl("/login", "notice", "account_deleted"));
}
