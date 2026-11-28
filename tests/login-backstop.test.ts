import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// R4 (re-audit 2): the per-email backstop ignores IPs entirely. Twenty
// failures from twenty DIFFERENT IPs (none of which trips the pair
// lockout or the per-IP cap) still lock the email briefly — and with
// TRUST_PROXY off, a spoofed X-Forwarded-For buys the attacker nothing.
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.TRUST_PROXY = "1";

const jar = new Map<string, string>();
(globalThis as Record<string, unknown>).__cookieJar = jar;
(globalThis as Record<string, unknown>).__testIp = "203.0.113.1";

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

run("R4: per-email backstop across rotating IPs (DB, mail mocked)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, authActions: any, authUtils: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const email = `r4-victim-${suffix}@example.com`;
  const password = "Backstop-Pass-2026!";
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

  it("20 failures from 20 different IPs trip the backstop: even the right password is refused", async () => {
    for (let i = 1; i <= 20; i++) {
      setIp(`203.0.113.${i}`);
      await expect(authActions.loginAction(form({ email, password: "wrong-guess" })))
        .rejects.toThrow(/NEXT_REDIRECT \/login\?error=invalid_credentials/);
    }
    setIp("198.51.100.200"); // a fresh IP the attacker has never used
    jar.clear();
    await expect(authActions.loginAction(form({ email, password })))
      .rejects.toThrow(/NEXT_REDIRECT \/login\?error=invalid_credentials/);
    expect(jar.get("session")).toBeUndefined();
    expect(jar.get("device_challenge")).toBeUndefined();
  }, 120000);

  it("with TRUST_PROXY off, clientIp ignores the spoofed header entirely", async () => {
    const { clientIp } = await import("../lib/ratelimit");
    const hdrs = new Headers({ "x-forwarded-for": "1.2.3.4" });
    const saved = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    expect(clientIp(hdrs)).toBe("unknown");
    process.env.TRUST_PROXY = saved;
    expect(clientIp(hdrs)).toBe("1.2.3.4");
  }, 30000);
});
