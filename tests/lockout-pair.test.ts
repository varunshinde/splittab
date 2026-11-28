import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// F4 residual (re-audit): the login lockout is scoped to the (email, IP)
// pair. Five bad guesses from an attacker's IP lock out THAT pair only —
// the victim, signing in from their own IP with the correct password, is
// unaffected (previously the attacker could keep the victim locked out
// indefinitely).
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

process.env.TRUST_PROXY = "1"; // these tests run behind a trusted proxy
const jar = new Map<string, string>();
(globalThis as Record<string, unknown>).__cookieJar = jar;
(globalThis as Record<string, unknown>).__testIp = "203.0.113.66"; // attacker

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
  headers: async () => new Headers({
    "x-forwarded-for": String((globalThis as Record<string, unknown>).__testIp),
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0",
  }),
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
  deviceCodeEmailHtml: (code: string) => code,
  newSigninAlertEmailHtml: () => "signin-alert",
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("F4 residual: lockout is per (email, IP) pair (DB, mail mocked)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, authActions: any, authUtils: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const email = `f4-victim-${suffix}@example.com`;
  const password = "Victim-Pass-2026!";
  let userId = "";
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const setIp = (ip: string) => { (globalThis as Record<string, unknown>).__testIp = ip; };

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    authActions = await import("../app/auth-actions");
    authUtils = await import("../lib/auth-utils");
    const u = await prisma.user.create({
      data: { name: "Victim", email, passwordHash: await authUtils.hashPassword(password), emailVerifiedAt: new Date() },
    });
    userId = u.id;
  }, 60000);

  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { email } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("5 bad guesses from the attacker IP lock out the attacker pair — even with the right password", async () => {
    setIp("203.0.113.66");
    for (let i = 0; i < 5; i++) {
      await expect(authActions.loginAction(form({ email, password: "wrong-guess" })))
        .rejects.toThrow(/NEXT_REDIRECT \/login\?error=invalid_credentials/);
    }
    jar.clear();
    await expect(authActions.loginAction(form({ email, password })))
      .rejects.toThrow(/NEXT_REDIRECT \/login\?error=invalid_credentials/);
    expect(jar.get("session")).toBeUndefined();
    expect(jar.get("device_challenge")).toBeUndefined();
  }, 60000);

  it("the victim from a different IP is NOT locked out: correct password reaches the device-code step", async () => {
    setIp("198.51.100.7");
    jar.clear();
    await expect(authActions.loginAction(form({ email, password })))
      .rejects.toThrow(/NEXT_REDIRECT \/verify-device/);
    expect(jar.get("device_challenge")).toBeTruthy();
  }, 60000);
});
