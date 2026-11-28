import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// N5 (re-audit): expenses are VOIDED, not hard-deleted. A participant can
// void, but the row, its splits and an activity entry survive — the debt
// stops counting, the payer's receivable is never silently erased.
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.27" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("N5: expense voiding keeps the audit trail (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, actions: any, authUtils: any, balances: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let alice: any, bob: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const form = (fields: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
      else fd.set(k, v);
    }
    return fd;
  };
  let tokenA = "", tokenB = "";
  let expenseId = "";
  const net = async () => {
    const expenses = await prisma.expense.findMany({
      where: { OR: [{ paidById: alice.id }, { paidById: bob.id }] },
      include: { splits: true },
    });
    return balances.netBetween(alice.id, bob.id, expenses, []);
  };

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    actions = await import("../app/actions");
    balances = await import("../lib/balances");
    authUtils = await import("../lib/auth-utils");
    alice = await prisma.user.create({ data: { name: "Alice", email: `n5-alice-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    bob = await prisma.user.create({ data: { name: "Bob", email: `n5-bob-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    const [a, b] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];
    await prisma.friendship.create({ data: { userAId: a, userBId: b, status: "ACCEPTED" } });
    tokenA = authUtils.generateSessionToken();
    tokenB = authUtils.generateSessionToken();
    await prisma.session.createMany({ data: [
      { tokenHash: authUtils.hashToken(tokenA), userId: alice.id, expiresAt: authUtils.sessionExpiry() },
      { tokenHash: authUtils.hashToken(tokenB), userId: bob.id, expiresAt: authUtils.sessionExpiry() },
    ] });
  }, 60000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("Alice adds a $100 friend expense; Bob owes $50", async () => {
    jar.set("session", tokenA);
    await expect(actions.addExpenseForm(form({
      context: "friends", description: "Team lunch", amount: "100.00", currency: "USD",
      paidById: alice.id, participantIds: [alice.id, bob.id],
    }))).rejects.toThrow(/NEXT_REDIRECT/);
    const e = await prisma.expense.findFirst({ where: { paidById: alice.id } });
    expenseId = e.id;
    expect(await net()).toBe(5000);
  });

  it("Bob (a participant) voids it: balance zeroes, row + splits + activity survive", async () => {
    jar.set("session", tokenB);
    await expect(actions.deleteExpenseForm(form({ expenseId }))).rejects.toThrow(/NEXT_REDIRECT/);
    const e = await prisma.expense.findUnique({ where: { id: expenseId }, include: { splits: true } });
    expect(e).not.toBeNull(); // NOT hard-deleted
    expect(e.voidedAt).not.toBeNull();
    expect(e.voidedById).toBe(bob.id);
    expect(e.splits.length).toBe(2); // audit trail intact
    expect(await net()).toBe(0); // but it no longer counts
    const act = await prisma.activity.findFirst({ where: { type: "expense_voided", userId: bob.id } });
    expect(act).not.toBeNull(); // friend expenses write activity too (N5)
    expect(act.message).toContain("Team lunch");
  });

  it("voiding an already-voided expense is refused", async () => {
    jar.set("session", tokenA);
    await expect(actions.deleteExpenseForm(form({ expenseId }))).rejects.toThrow(/already voided/);
  });
});
