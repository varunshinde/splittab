import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// F1 consent flow against the real dev database: friend requests are
// PENDING until accepted, pending friends can't be put on expenses, an
// affected participant can delete an expense, and blocks are sticky.
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

process.env.TRUST_PROXY = "1"; // these tests run behind a trusted proxy
const jar = new Map<string, string>();
(globalThis as Record<string, unknown>).__cookieJar = jar;

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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.23" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("F1: friend consent, expense gating, delete, block (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, actions: any, authUtils: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let userA: any, userB: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const form = (fields: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
      else fd.set(k, v);
    }
    return fd;
  };
  const asUser = (token: string) => jar.set("session", token);
  let tokenA = "", tokenB = "";

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    actions = await import("../app/actions");
    authUtils = await import("../lib/auth-utils");
    userA = await prisma.user.create({ data: { name: "Consent A", email: `consent-a-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    userB = await prisma.user.create({ data: { name: "Consent B", email: `consent-b-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    tokenA = authUtils.generateSessionToken();
    tokenB = authUtils.generateSessionToken();
    await prisma.session.createMany({ data: [
      { tokenHash: authUtils.hashToken(tokenA), userId: userA.id, expiresAt: authUtils.sessionExpiry() },
      { tokenHash: authUtils.hashToken(tokenB), userId: userB.id, expiresAt: authUtils.sessionExpiry() },
    ] });
  }, 60000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("add-by-email creates a PENDING request, and a pending friend CANNOT be put on an expense", async () => {
    asUser(tokenA);
    await expect(actions.addFriendForm(form({ email: userB.email }))).rejects.toThrow(/NEXT_REDIRECT \/friends\?notice=/);
    const row = await prisma.friendship.findFirst({ where: { OR: [{ userAId: userA.id }, { userBId: userA.id }] } });
    expect(row.status).toBe("PENDING");
    expect(row.requestedById).toBe(userA.id);
    await expect(actions.addExpenseForm(form({
      context: "friends", description: "Sneaky debt", amount: "10.00", currency: "USD",
      paidById: userA.id, participantIds: [userB.id],
    }))).rejects.toThrow(/not in scope/);
    expect(await prisma.expense.count({ where: { paidById: userA.id } })).toBe(0);
  }, 30000);

  it("after acceptance the expense works, and the OTHER participant can void it (N5: void, not hard delete)", async () => {
    asUser(tokenB);
    await expect(actions.acceptFriendForm(form({ friendId: userA.id }))).rejects.toThrow(/NEXT_REDIRECT \/friends/);
    const row = await prisma.friendship.findFirst({ where: { status: "ACCEPTED", OR: [{ userAId: userA.id, userBId: userB.id }, { userAId: userB.id, userBId: userA.id }] } });
    expect(row).not.toBeNull();
    asUser(tokenA);
    await expect(actions.addExpenseForm(form({
      context: "friends", description: "Agreed dinner", amount: "20.00", currency: "USD",
      paidById: userA.id, participantIds: [userB.id],
    }))).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    const expense = await prisma.expense.findFirst({ where: { paidById: userA.id } });
    expect(expense).not.toBeNull();
    // B is a split participant (the affected party) and may void it.
    asUser(tokenB);
    await expect(actions.deleteExpenseForm(form({ expenseId: expense.id }))).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    // N5: the row survives as voided history — it is never hard-deleted.
    const voided = await prisma.expense.findUnique({ where: { id: expense.id } });
    expect(voided).not.toBeNull();
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.voidedById).toBe(userB.id);
  }, 30000);

  it("blocking is sticky: the blocked user cannot re-request", async () => {
    asUser(tokenA);
    await expect(actions.blockUserForm(form({ friendId: userB.id }))).rejects.toThrow(/NEXT_REDIRECT \/friends/);
    let row = await prisma.friendship.findFirst({ where: { status: "BLOCKED", OR: [{ userAId: userA.id, userBId: userB.id }, { userAId: userB.id, userBId: userA.id }] } });
    expect(row?.blockedById).toBe(userA.id);
    asUser(tokenB);
    await expect(actions.addFriendForm(form({ email: userA.email }))).rejects.toThrow(/NEXT_REDIRECT \/friends\?notice=/);
    row = await prisma.friendship.findFirst({ where: { status: "BLOCKED", OR: [{ userAId: userA.id, userBId: userB.id }, { userAId: userB.id, userBId: userA.id }] } });
    expect(row).not.toBeNull(); // still blocked, no PENDING row was created
    expect(await prisma.friendship.count()).toBeGreaterThanOrEqual(0);
    const anyPending = await prisma.friendship.findFirst({ where: { status: "PENDING", OR: [{ userAId: userA.id, userBId: userB.id }, { userAId: userB.id, userBId: userA.id }] } });
    expect(anyPending).toBeNull();
  }, 30000);
});
