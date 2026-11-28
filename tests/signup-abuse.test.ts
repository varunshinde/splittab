import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// N7 (re-audit): signup mail gets the same per-email cap as resend
// (rotating IPs must not flood one inbox), and a squatted display name
// does not survive the real owner's first-password recovery.
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

process.env.TRUST_PROXY = "1"; // these tests run behind a trusted proxy
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
  deviceCodeEmailHtml: (code: string) => code,
  newSigninAlertEmailHtml: () => "signin-alert",
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("N7: signup send cap + squatted-name recovery (DB, mail mocked)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, authActions: any, mail: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const email = `n7-victim-${suffix}@example.com`;
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const tokenFromLink = (link: string) => new URL(link).searchParams.get("token")!;

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    authActions = await import("../app/auth-actions");
    mail = await import("../lib/mail");
  }, 60000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("repeated signups for one email send ONE email, not one per attempt", async () => {
    mail.sendEmail.mockClear();
    for (let i = 0; i < 3; i++) {
      await expect(authActions.signupAction(form({ name: "Acme Bank Support Team", email })))
        .rejects.toThrow(/NEXT_REDIRECT \/login\?notice=signup_check_email/);
    }
    expect(mail.sendEmail.mock.calls.length).toBe(1);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user.name).toBe("Acme Bank Support Team"); // squatted — for now
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).toBeNull();
  });

  it("the real owner recovering via forgot-password sets their OWN name with the first password", async () => {
    mail.sendEmail.mockClear();
    await expect(authActions.forgotPasswordAction(form({ email })))
      .rejects.toThrow(/NEXT_REDIRECT/);
    const link = mail.sendEmail.mock.calls[mail.sendEmail.mock.calls.length - 1][0].html as string;
    const token = tokenFromLink(link);
    await expect(authActions.resetPasswordAction(form({ token, password: "Owner-Chosen-2026!", name: "Real Owner" })))
      .rejects.toThrow(/NEXT_REDIRECT \/login\?notice=password_updated/);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user.name).toBe("Real Owner");
    expect(user.passwordHash).toBeTruthy();
    expect(user.emailVerifiedAt).not.toBeNull();
  });
});
