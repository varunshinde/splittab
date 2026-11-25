import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// Load .env.local BEFORE importing app modules (lib/db reads DATABASE_URL
// at import time). The mail layer is MOCKED — no real Resend calls.
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const jar = new Map<string, string>();
(globalThis as Record<string, unknown>).__cookieJar = jar;
(globalThis as Record<string, unknown>).__testIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = (globalThis as Record<string, unknown>).__cookieJar as Map<string, string>;
      const value = v.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => { ((globalThis as Record<string, unknown>).__cookieJar as Map<string, string>).set(name, value); },
    delete: (name: string) => { ((globalThis as Record<string, unknown>).__cookieJar as Map<string, string>).delete(name); },
  }),
  headers: async () => new Headers({ "x-forwarded-for": String((globalThis as Record<string, unknown>).__testIp) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("../lib/mail", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, dev: true })),
  getAppUrl: () => "http://localhost:3000",
  verificationEmailHtml: (link: string) => link,
  resetEmailHtml: (link: string) => link,
  existingAccountEmailHtml: () => "existing-account notice",
}));

import { tokenState, tokenExpiry, VERIFICATION_TTL_MS, RESET_TTL_MS } from "../lib/tokens";
import { isEmailSendIpThrottled, isEmailSendThrottled, EMAIL_SEND_IP_MAX_PER_DAY } from "../lib/ratelimit";
import { hashToken } from "../lib/auth-utils";

describe("email token state logic (pure)", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  it("missing / used / expired / valid", () => {
    expect(tokenState(null, now)).toBe("missing");
    expect(tokenState({ expiresAt: tokenExpiry(1000, now), usedAt: now }, now)).toBe("used");
    expect(tokenState({ expiresAt: new Date(now.getTime() - 1), usedAt: null }, now)).toBe("expired");
    expect(tokenState({ expiresAt: tokenExpiry(1000, now), usedAt: null }, now)).toBe("valid");
  });
  it("TTLs: verification 24h, reset 1h", () => {
    expect(VERIFICATION_TTL_MS).toBe(24 * 3600 * 1000);
    expect(RESET_TTL_MS).toBe(3600 * 1000);
    expect(tokenExpiry(RESET_TTL_MS, now).getTime() - now.getTime()).toBe(RESET_TTL_MS);
  });
  it("stored form is a SHA-256 hash, never the raw token", () => {
    const raw = "abc123token";
    expect(hashToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(raw)).not.toContain(raw);
  });
});

describe("email send throttling (pure)", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const at = (minAgo: number) => ({ succeeded: true, createdAt: new Date(now.getTime() - minAgo * 60000) });
  it("blocks a second send within a minute", () => {
    expect(isEmailSendThrottled([at(0.5)], now)).toBe(true);
    expect(isEmailSendThrottled([at(2)], now)).toBe(false);
  });
  it("blocks the 6th send within a day", () => {
    expect(isEmailSendThrottled([at(70), at(140), at(210), at(280), at(350)], now)).toBe(true);
    expect(isEmailSendThrottled([at(70), at(140), at(210), at(280)], now)).toBe(false);
  });
  it("per-IP: blocks at 20 sends within a day, ignores older sends", () => {
    const sends = (n: number, minAgo: number) => Array.from({ length: n }, () => at(minAgo));
    expect(EMAIL_SEND_IP_MAX_PER_DAY).toBe(20);
    expect(isEmailSendIpThrottled(sends(19, 60), now)).toBe(false);
    expect(isEmailSendIpThrottled(sends(20, 60), now)).toBe(true);
    expect(isEmailSendIpThrottled(sends(20, 25 * 60), now)).toBe(false); // all >24h old
    expect(isEmailSendIpThrottled([...sends(19, 60), ...sends(5, 25 * 60)], now)).toBe(false);
  });
});

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("email verification + password reset flow (DB, mail mocked)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, authActions: any, mail: any, verifyPage: any, authUtils: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const email = `verify-${suffix}@example.com`;
  const password = "verify-pass-123";
  let userId: string;
  let verifyLink: string;

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const lastMailLink = (): string => {
    const calls = mail.sendEmail.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][0].html as string; // mocked html = the raw link
  };
  const tokenFromLink = (link: string) => new URL(link).searchParams.get("token")!;

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    authActions = await import("../app/auth-actions");
    mail = await import("../lib/mail");
    verifyPage = (await import("../app/verify-email/page")).default;
    authUtils = await import("../lib/auth-utils");
  }, 60000);

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("signup collects NO password (F2): account starts passwordless + unverified, link is emailed", async () => {
    jar.clear();
    await expect(authActions.signupAction(form({ name: "Vera", email })))
      .rejects.toThrow(/NEXT_REDIRECT \/login\?notice=/);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    userId = user.id;
    expect(user.passwordHash).toBeNull(); // no password exists until the owner sets one
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.isPlaceholder).toBe(false);
    expect(jar.get("session")).toBeUndefined(); // not logged in
    expect(mail.sendEmail).toHaveBeenCalled();
    const sentTo = mail.sendEmail.mock.calls[mail.sendEmail.mock.calls.length - 1][0].to;
    expect(sentTo).toBe(email);
    verifyLink = lastMailLink();
    const tokens = await prisma.emailVerificationToken.findMany({ where: { userId } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens[0].usedAt).toBeNull();
  }, 30000);

  it("login is impossible before setup completes (no password exists to guess)", async () => {
    jar.clear();
    await expect(authActions.loginAction(form({ email, password })))
      .rejects.toThrow(/NEXT_REDIRECT \/login\?error=/);
    expect(jar.get("session")).toBeUndefined();
  }, 30000);

  it("the setup page GET does NOT consume the token (F9); completing signup sets the password exactly once", async () => {
    const token = tokenFromLink(verifyLink);
    // A mail scanner / prefetcher hitting the link must not burn it.
    await verifyPage({ searchParams: Promise.resolve({ token }) });
    let tokenRow = await prisma.emailVerificationToken.findFirst({ where: { userId } });
    expect(tokenRow.usedAt).toBeNull();
    let user = await prisma.user.findUnique({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toBeNull();
    // The owner completes setup: password set, email verified, token used.
    await expect(authActions.completeSignupAction(form({ token, name: "Vera", password })))
      .rejects.toThrow(/NEXT_REDIRECT \/login\?notice=/);
    user = await prisma.user.findUnique({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    await expect(authUtils.verifyPassword(password, user.passwordHash)).resolves.toBe(true);
    tokenRow = await prisma.emailVerificationToken.findFirst({ where: { userId } });
    expect(tokenRow.usedAt).not.toBeNull();
    // Replay: the same token cannot set a second password.
    await expect(authActions.completeSignupAction(form({ token, name: "Vera", password: "attacker-pass-999" })))
      .rejects.toThrow(/NEXT_REDIRECT \/login\?error=/);
    const user2 = await prisma.user.findUnique({ where: { email } });
    await expect(authUtils.verifyPassword(password, user2.passwordHash)).resolves.toBe(true);
    // Login now succeeds and mints a session.
    jar.clear();
    await expect(authActions.loginAction(form({ email, password }))).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    expect(jar.get("session")).toBeTruthy();
    const sessions = await prisma.session.count({ where: { userId } });
    expect(sessions).toBe(1);
  }, 30000);

  it("duplicate signup is indistinguishable and creates nothing (F3)", async () => {
    const before = await prisma.user.count({ where: { email } });
    await expect(authActions.signupAction(form({ name: "Copy Cat", email })))
      .rejects.toThrow(/NEXT_REDIRECT \/login\?notice=/);
    expect(await prisma.user.count({ where: { email } })).toBe(before);
    const tokens = await prisma.emailVerificationToken.count({ where: { userId } });
    expect(tokens).toBe(1); // no new setup token was issued
  }, 30000);

  it("password reset: generic request, token works once, ALL sessions revoked", async () => {
    mail.sendEmail.mockClear();
    await expect(authActions.forgotPasswordAction(form({ email })))
      .rejects.toThrow(/NEXT_REDIRECT \/forgot-password\?notice=/);
    const link = lastMailLink();
    expect(link).toContain("/reset-password?token=");
    const token = tokenFromLink(link);
    // Unknown email gets the same generic response (no enumeration).
    await expect(authActions.forgotPasswordAction(form({ email: `ghost-${suffix}@example.com` })))
      .rejects.toThrow(/NEXT_REDIRECT \/forgot-password\?notice=/);
    const newPassword = "brand-new-pass-456";
    await expect(authActions.resetPasswordAction(form({ token, password: newPassword })))
      .rejects.toThrow(/NEXT_REDIRECT \/login\?notice=/);
    const user = await prisma.user.findUnique({ where: { email } });
    await expect(authUtils.verifyPassword(newPassword, user.passwordHash)).resolves.toBe(true);
    const sessions = await prisma.session.count({ where: { userId } });
    expect(sessions).toBe(0); // every session revoked
    // Token is single-use.
    await expect(authActions.resetPasswordAction(form({ token, password: "another-pass-789" })))
      .rejects.toThrow(/reset-password\?error=/);
    const user2 = await prisma.user.findUnique({ where: { email } });
    await expect(authUtils.verifyPassword(newPassword, user2.passwordHash)).resolves.toBe(true);
  }, 30000);
});
