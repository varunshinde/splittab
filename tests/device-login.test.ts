import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// New-device login flow against the real dev database, mail MOCKED: the
// mocked deviceCodeEmailHtml returns the raw code as the "html", so tests
// can read the code out of the recorded sendEmail call.
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const jar = new Map<string, string>();
(globalThis as Record<string, unknown>).__cookieJar = jar;
(globalThis as Record<string, unknown>).__testIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;
(globalThis as Record<string, unknown>).__testUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
(globalThis as Record<string, unknown>).__testGeo = { city: "Denver", region: "CO", country: "US" };

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
  headers: async () => {
    const g = (globalThis as Record<string, unknown>).__testGeo as { city: string; region: string; country: string };
    return new Headers({
      "x-forwarded-for": String((globalThis as Record<string, unknown>).__testIp),
      "user-agent": String((globalThis as Record<string, unknown>).__testUa),
      "x-vercel-ip-city": g.city,
      "x-vercel-ip-country-region": g.region,
      "x-vercel-ip-country": g.country,
    });
  },
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

run("new-device login: email code challenge + trusted devices (DB, mail mocked)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, authActions: any, mail: any, authUtils: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const email = `device-${suffix}@example.com`;
  const password = "device-pass-123";
  let userId: string;
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const lastCode = (): string => {
    const calls = mail.sendEmail.mock.calls;
    return calls[calls.length - 1][0].html as string; // mocked html = the raw code
  };
  let firstCode = "";

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    authActions = await import("../app/auth-actions");
    mail = await import("../lib/mail");
    authUtils = await import("../lib/auth-utils");
    const user = await prisma.user.create({
      data: { name: "Dev", email, passwordHash: await authUtils.hashPassword(password), emailVerifiedAt: new Date() },
    });
    userId = user.id;
  }, 60000);

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("first login from a new device: NO session, a code is emailed instead", async () => {
    jar.clear();
    mail.sendEmail.mockClear();
    await expect(authActions.loginAction(form({ email, password }))).rejects.toThrow(/NEXT_REDIRECT \/verify-device/);
    expect(jar.get("session")).toBeUndefined();
    expect(jar.get("device_challenge")).toBeTruthy();
    expect(mail.sendEmail).toHaveBeenCalled();
    expect(lastCode()).toMatch(/^\d{6}$/);
    firstCode = lastCode(); // capture now: vitest 5 clears mock history between tests
    const challenge = await prisma.loginChallenge.findFirst({ where: { userId } });
    expect(challenge).not.toBeNull();
    expect(challenge.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.city).toBe("Denver");
    expect(challenge.country).toBe("US");
  }, 30000);

  it("wrong code: no session, attempt counted; right code: session + device trusted + alert emailed", async () => {
    const code = firstCode;
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(authActions.verifyDeviceAction(form({ code: wrong, trust: "on" })))
      .rejects.toThrow(/NEXT_REDIRECT \/verify-device\?error=/);
    expect(jar.get("session")).toBeUndefined();
    let challenge = await prisma.loginChallenge.findFirst({ where: { userId } });
    expect(challenge.attempts).toBe(1);
    mail.sendEmail.mockClear();
    await expect(authActions.verifyDeviceAction(form({ code, trust: "on" })))
      .rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    expect(jar.get("session")).toBeTruthy();
    expect(jar.get("device_challenge")).toBeUndefined();
    challenge = await prisma.loginChallenge.findFirst({ where: { userId } });
    expect(challenge.usedAt).not.toBeNull();
    const device = await prisma.trustedDevice.findFirst({ where: { userId } });
    expect(device).not.toBeNull();
    expect(device.city).toBe("Denver");
    expect(mail.sendEmail).toHaveBeenCalled(); // "new device" alert
  }, 30000);

  it("second login from the now-trusted device goes straight in; a new location triggers an alert", async () => {
    await prisma.session.deleteMany({ where: { userId } });
    jar.clear();
    mail.sendEmail.mockClear();
    await expect(authActions.loginAction(form({ email, password }))).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    expect(jar.get("session")).toBeTruthy();
    expect(mail.sendEmail).not.toHaveBeenCalled(); // same device + same place: silent
    // Same device, different city -> still trusted, but an alert goes out.
    await prisma.session.deleteMany({ where: { userId } });
    jar.clear();
    (globalThis as Record<string, unknown>).__testGeo = { city: "Austin", region: "TX", country: "US" };
    await expect(authActions.loginAction(form({ email, password }))).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    expect(mail.sendEmail).toHaveBeenCalled();
    const device = await prisma.trustedDevice.findFirst({ where: { userId } });
    expect(device.city).toBe("Austin");
    (globalThis as Record<string, unknown>).__testGeo = { city: "Denver", region: "CO", country: "US" };
  }, 30000);

  it("after the device is revoked, login challenges again", async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.trustedDevice.deleteMany({ where: { userId } });
    // Reset the per-email code-send throttle (1/min) so this test's fresh
    // challenge isn't throttled by the code sent moments ago in test 1.
    await prisma.loginAttempt.deleteMany({ where: { kind: "device_code", email } });
    jar.clear();
    await expect(authActions.loginAction(form({ email, password }))).rejects.toThrow(/NEXT_REDIRECT \/verify-device/);
    expect(jar.get("session")).toBeUndefined();
  }, 30000);
});
