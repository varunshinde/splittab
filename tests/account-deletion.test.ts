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
    await prisma.trustedDevice.create({ data: { userId, deviceHash: "d".repeat(64), userAgent: "test", ipAddress: "127.0.0.1", city: "Unknown", region: "Unknown", country: "Unknown" } });
  });

  afterAll(async () => {
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
  });
});
