import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";

try {
  const raw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

class RedirectError extends Error { url: string; constructor(url: string) { super("REDIRECT"); this.url = url; } }
const jar = new Map<string, string>();
const hdrs = new Map<string, string>([["user-agent", "Mozilla/5.0 (Deletion Test)"]]);

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new RedirectError(url); } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => ({ get: (n: string) => hdrs.get(n.toLowerCase()) ?? null }),
}));

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { if (e instanceof RedirectError) return e.url; throw e; }
  throw new Error("expected a redirect");
}

d("F12 account deletion (tombstone)", () => {
  let prisma: any, deleteAccountAction: any, hashPassword: any, SESSION_COOKIE: string;
  let userId: string;
  let bystanderId: string;
  const EMAIL = "deltest@example.com";
  const PASSWORD = "Delete-Me-2026!";

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    ({ deleteAccountAction } = await import("../app/auth-actions"));
    ({ hashPassword } = await import("../lib/auth-utils"));
    SESSION_COOKIE = (await import("../lib/auth")).SESSION_COOKIE;
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    const u = await prisma.user.create({
      data: { name: "Del Test", email: EMAIL, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() },
    });
    userId = u.id;
    // A live session for the cookie-based requireUser().
    const raw = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    await prisma.session.create({ data: { userId, tokenHash, expiresAt: new Date(Date.now() + 3600e3) } });
    jar.set(SESSION_COOKIE, raw);
    await prisma.trustedDevice.create({ data: { userId, tokenHash: "d".repeat(64), userAgent: "test", ipAddress: "127.0.0.1", city: "Unknown", region: "Unknown", country: "Unknown", expiresAt: new Date(Date.now() + 90 * 24 * 3600e3) } });
    // N10 remnants: an activity message embedding the real name, and
    // LoginAttempt rows carrying the email/IP history.
    await prisma.activity.create({ data: { userId, type: "member_joined", message: "Del Test joined the group" } });
    const bystander = await prisma.user.create({
      data: { name: "Bystander", email: `bystander-${Date.now()}@example.com`, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() },
    });
    bystanderId = bystander.id;
    await prisma.activity.create({ data: { userId: bystanderId, type: "expense_voided", message: 'Expense "Del Test memorial dinner" voided by Bystander' } });
    await prisma.loginAttempt.create({ data: { kind: "login", email: EMAIL, ip: "198.51.100.99", succeeded: true } });
  });

  afterAll(async () => {
    await prisma.activity.deleteMany({ where: { userId: bystanderId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: bystanderId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const form = (pw: string) => { const f = new FormData(); f.set("current_password", pw); return f; };

  it("wrong password refuses and leaves the account intact", async () => {
    const url = await expectRedirect(deleteAccountAction(form("not-the-password")));
    expect(url).toBe("/settings?error=current_password_wrong");
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u.email).toBe(EMAIL);
    expect(u.passwordHash).toBeTruthy();
  });

  it("correct password tombstones: identity wiped, access gone, ledger row kept", async () => {
    const url = await expectRedirect(deleteAccountAction(form(PASSWORD)));
    expect(url).toBe("/login?notice=account_deleted");
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u).not.toBeNull(); // row survives for other people's ledgers
    expect(u.name).toBe("Deleted user");
    expect(u.email).toContain("@deleted.splittab.invalid");
    expect(u.passwordHash).toBeNull();
    expect(u.emailVerifiedAt).toBeNull();
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    expect(await prisma.trustedDevice.count({ where: { userId } })).toBe(0);
    // R1: the leaver's OWN authored messages are neutralized, and the
    // LoginAttempt history for the email is purged...
    const acts = await prisma.activity.findMany({ where: { userId } });
    expect(acts.length).toBeGreaterThan(0);
    for (const a of acts) expect(a.message).toBe("Activity by a deleted user");
    expect(await prisma.loginAttempt.count({ where: { email: EMAIL } })).toBe(0);
    // ...but another user's message that merely contains the leaver's
    // name as a substring is NOT rewritten (the old global scrub did).
    const bystanderActs = await prisma.activity.findMany({ where: { userId: bystanderId } });
    expect(bystanderActs[0].message).toBe('Expense "Del Test memorial dinner" voided by Bystander');
  });
});
