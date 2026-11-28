import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// N3 (re-audit): a settlement is a CLAIM, not a fact. It starts PENDING
// and moves balances only when the other party confirms it; it can be
// rejected, cancelled by its recorder, or voided after confirmation —
// with the row kept as the audit trail.
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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.26" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("N3: settlements need counterparty confirmation (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, actions: any, authUtils: any, balances: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let alice: any, bob: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  let tokenA = "", tokenB = "";
  const net = async () => {
    const expenses = await prisma.expense.findMany({
      where: { OR: [{ paidById: alice.id }, { paidById: bob.id }] },
      include: { splits: true },
    });
    const settlements = await prisma.settlement.findMany({
      where: { OR: [{ fromUserId: alice.id }, { fromUserId: bob.id }] },
    });
    return balances.netBetween(alice.id, bob.id, expenses, settlements);
  };

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    actions = await import("../app/actions");
    balances = await import("../lib/balances");
    authUtils = await import("../lib/auth-utils");
    alice = await prisma.user.create({ data: { name: "Alice", email: `n3-alice-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    bob = await prisma.user.create({ data: { name: "Bob", email: `n3-bob-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    const [a, b] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];
    await prisma.friendship.create({ data: { userAId: a, userBId: b, status: "ACCEPTED" } });
    // Alice paid $100 split equally: Bob owes Alice $50 (net +5000 for Alice).
    await prisma.expense.create({
      data: {
        description: "Dinner", amountInCents: 10000, currency: "USD", paidById: alice.id, date: new Date(),
        splits: { create: [
          { userId: alice.id, amountOwedInCents: 5000 },
          { userId: bob.id, amountOwedInCents: 5000 },
        ] },
      },
    });
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

  it("baseline: Bob owes Alice $50", async () => {
    expect(await net()).toBe(5000);
  });

  it("a forged $2,500 settlement is PENDING and changes NO balance", async () => {
    jar.set("session", tokenB);
    await expect(actions.recordSettlementForm(form({
      fromUserId: bob.id, toUserId: alice.id, amount: "2500.00", currency: "USD", back: `/friends/${alice.id}`,
    }))).rejects.toThrow(/NEXT_REDIRECT/);
    const s = await prisma.settlement.findFirst({ where: { fromUserId: bob.id } });
    expect(s.status).toBe("PENDING");
    expect(s.recordedById).toBe(bob.id);
    expect(await net()).toBe(5000); // unchanged
  });

  it("the recorder cannot confirm their own entry; the counterparty can", async () => {
    const s = await prisma.settlement.findFirst({ where: { fromUserId: bob.id } });
    jar.set("session", tokenB);
    await expect(actions.confirmSettlementForm(form({ settlementId: s.id, back: "/friends" })))
      .rejects.toThrow(/cannot confirm your own/);
    jar.set("session", tokenA);
    await expect(actions.confirmSettlementForm(form({ settlementId: s.id, back: "/friends" })))
      .rejects.toThrow(/NEXT_REDIRECT/);
    expect((await prisma.settlement.findUnique({ where: { id: s.id } })).status).toBe("CONFIRMED");
    expect(await net()).toBe(5000 - 250000); // now it counts: Alice "owes" Bob back
  });

  it("R6: voiding a confirmed settlement needs the other party's agreement", async () => {
    const s = await prisma.settlement.findFirst({ where: { fromUserId: bob.id } });
    jar.set("session", tokenA);
    await expect(actions.voidSettlementForm(form({ settlementId: s.id, back: "/friends" })))
      .rejects.toThrow(/NEXT_REDIRECT/);
    // A request, not a fact: still CONFIRMED for balance purposes.
    expect((await prisma.settlement.findUnique({ where: { id: s.id } })).status).toBe("VOID_REQUESTED");
    expect(await net()).toBe(5000 - 250000); // still counts
    // The requester cannot agree to their own request.
    await expect(actions.confirmVoidSettlementForm(form({ settlementId: s.id, back: "/friends" })))
      .rejects.toThrow(/your own void request/);
    // The counterparty agrees: now it is voided and the balance is restored.
    jar.set("session", tokenB);
    await expect(actions.confirmVoidSettlementForm(form({ settlementId: s.id, back: "/friends" })))
      .rejects.toThrow(/NEXT_REDIRECT/);
    expect((await prisma.settlement.findUnique({ where: { id: s.id } })).status).toBe("VOIDED");
    expect(await net()).toBe(5000);
  });

  it("a pending settlement can be rejected by the counterparty", async () => {
    jar.set("session", tokenB);
    await expect(actions.recordSettlementForm(form({
      fromUserId: bob.id, toUserId: alice.id, amount: "50.00", currency: "USD", back: `/friends/${alice.id}`,
    }))).rejects.toThrow(/NEXT_REDIRECT/);
    const s = await prisma.settlement.findFirst({ where: { fromUserId: bob.id, status: "PENDING" } });
    jar.set("session", tokenA);
    await expect(actions.rejectSettlementForm(form({ settlementId: s.id, back: "/friends" })))
      .rejects.toThrow(/NEXT_REDIRECT/);
    expect((await prisma.settlement.findUnique({ where: { id: s.id } })).status).toBe("VOIDED");
    expect(await net()).toBe(5000);
  });
});
