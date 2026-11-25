import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// Load .env.local BEFORE importing app modules (lib/db reads DATABASE_URL
// at import time). These tests run against the real dev database and create
// two throwaway users; everything is cleaned up in afterAll.
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Session cookie jar the mocked next/headers reads from.
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
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("IDOR: two-user authorization", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, data: any, actions: any, auth: any, authUtils: any;
  let userA: { id: string }, userB: { id: string }, groupId: string, expenseId: string;
  let tokenA: string, tokenB: string;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    data = await import("../lib/data");
    actions = await import("../app/actions");
    auth = await import("../lib/auth");
    authUtils = await import("../lib/auth-utils");
    userA = await prisma.user.create({ data: { name: "Idor A", email: `idor-a-${suffix}@example.com`, passwordHash: "x" } });
    userB = await prisma.user.create({ data: { name: "Idor B", email: `idor-b-${suffix}@example.com`, passwordHash: "x" } });
    tokenA = authUtils.generateSessionToken();
    tokenB = authUtils.generateSessionToken();
    await prisma.session.createMany({ data: [
      { tokenHash: authUtils.hashToken(tokenA), userId: userA.id, expiresAt: authUtils.sessionExpiry() },
      { tokenHash: authUtils.hashToken(tokenB), userId: userB.id, expiresAt: authUtils.sessionExpiry() },
    ] });
    const group = await prisma.group.create({
      data: { name: "A-only group", members: { create: [{ userId: userA.id }] } },
    });
    groupId = group.id;
    const expense = await prisma.expense.create({
      data: {
        groupId, description: "A's private expense", amountInCents: 5000, paidById: userA.id,
        splits: { create: [{ userId: userA.id, amountOwedInCents: 5000 }] },
      },
    });
    expenseId = expense.id;
  }, 60000);

  afterAll(async () => {
    if (groupId) await prisma.group.delete({ where: { id: groupId } }).catch(() => {});
    if (userA && userB) await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("control: A can see A's own group and expense", async () => {
    expect(await data.getMyGroup(userA.id, groupId)).not.toBeNull();
    expect(await data.getMyExpense(userA.id, expenseId)).not.toBeNull();
  });

  it("group page data: non-member B gets null (page renders 404)", async () => {
    expect(await data.getMyGroup(userB.id, groupId)).toBeNull();
  });

  it("receipt/expense data: non-participant B gets null (page renders 404)", async () => {
    expect(await data.getMyExpense(userB.id, expenseId)).toBeNull();
  });

  it("expense action: B cannot add an expense to A's group", async () => {
    jar.set("session", tokenB);
    const fd = new FormData();
    fd.set("groupId", groupId);
    fd.set("description", "intrusion");
    fd.set("amount", "10.00");
    fd.set("currency", "USD");
    fd.set("category", "General");
    fd.set("paidById", userA.id);
    fd.set("mode", "equal");
    fd.append("participantIds", userA.id);
    await expect(actions.addGroupExpenseForm(fd)).rejects.toThrow(/not a member/);
    const count = await prisma.expense.count({ where: { groupId } });
    expect(count).toBe(1); // nothing was written
  }, 30000);

  it("settlement action: B cannot record a settlement with A (no shared relation)", async () => {
    jar.set("session", tokenB);
    const fd = new FormData();
    fd.set("fromUserId", userA.id);
    fd.set("toUserId", userB.id);
    fd.set("amount", "5.00");
    fd.set("back", "/dashboard");
    await expect(actions.recordSettlementForm(fd)).rejects.toThrow(/only settle up with/);
    const count = await prisma.settlement.count({ where: { OR: [{ fromUserId: userA.id }, { fromUserId: userB.id }] } });
    expect(count).toBe(0);
  }, 30000);

  it("session resolution: A's token resolves to A, B's to B, garbage to null", async () => {
    jar.set("session", tokenA);
    expect((await auth.getCurrentUser())?.id).toBe(userA.id);
    jar.set("session", tokenB);
    expect((await auth.getCurrentUser())?.id).toBe(userB.id);
    jar.set("session", "not-a-real-token");
    expect(await auth.getCurrentUser()).toBeNull();
  }, 30000);
});
