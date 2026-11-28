import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// Re-audit 2: R5 (receipts are the payer's), R6 (two-party void of
// confirmed settlements + pending cap), R7 (payer restore).
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.TRUST_PROXY = "1";

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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.40" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 7)]);

run("Re-audit 2: R5/R6/R7 (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, actions: any, authUtils: any, balances: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let alice: any, bob: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  let tokenA = "", tokenB = "";
  let expenseId = "";
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const as = (token: string) => jar.set("session", token);
  const swallow = async (p: Promise<unknown>) => { try { await p; } catch { /* redirect */ } };

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    actions = await import("../app/actions");
    authUtils = await import("../lib/auth-utils");
    balances = await import("../lib/balances");
    alice = await prisma.user.create({ data: { name: "Alice", email: `r5-alice-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    bob = await prisma.user.create({ data: { name: "Bob", email: `r5-bob-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    tokenA = authUtils.generateSessionToken();
    tokenB = authUtils.generateSessionToken();
    await prisma.session.createMany({ data: [
      { tokenHash: authUtils.hashToken(tokenA), userId: alice.id, expiresAt: authUtils.sessionExpiry() },
      { tokenHash: authUtils.hashToken(tokenB), userId: bob.id, expiresAt: authUtils.sessionExpiry() },
    ] });
    const [a, b] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];
    await prisma.friendship.create({ data: { userAId: a, userBId: b, status: "ACCEPTED", requestedById: alice.id } });
    const e = await prisma.expense.create({
      data: {
        description: `R5 dinner ${suffix}`, amountInCents: 4000, paidById: alice.id,
        splits: { create: [{ userId: bob.id, amountOwedInCents: 2000 }, { userId: alice.id, amountOwedInCents: 2000 }] },
      },
    });
    expenseId = e.id;
  }, 60000);

  afterAll(async () => {
    await prisma.expense.deleteMany({ where: { id: expenseId } }).catch(() => {});
    await prisma.settlement.deleteMany({ where: { OR: [{ fromUserId: alice.id }, { toUserId: alice.id }] } }).catch(() => {});
    await prisma.activity.deleteMany({ where: { userId: { in: [alice.id, bob.id] } } }).catch(() => {});
    await prisma.friendship.deleteMany({ where: { OR: [{ userAId: alice.id }, { userBId: alice.id }] } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("R5: a participant cannot upload or replace the payer's receipt; the payer can", async () => {
    as(tokenB);
    await expect(actions.uploadReceipt(expenseId, "receipt.png", PNG, "image/png")).rejects.toThrow(/only the payer/);
    as(tokenA);
    const receipt = await actions.uploadReceipt(expenseId, "receipt.png", PNG, "image/png");
    expect(receipt.id).toBeTruthy();
    const payer = await prisma.user.findUnique({ where: { id: alice.id } });
    expect(Number(payer.receiptStorageUsedBytes)).toBe(PNG.byteLength);
    // Replace as the payer: counter reflects the new file, never negative.
    const PNG2 = Buffer.concat([PNG, Buffer.alloc(100, 9)]);
    await actions.uploadReceipt(expenseId, "receipt2.png", PNG2, "image/png");
    const payer2 = await prisma.user.findUnique({ where: { id: alice.id } });
    expect(Number(payer2.receiptStorageUsedBytes)).toBe(PNG2.byteLength);
  }, 30000);

  it("R5+R7: voided expenses reject uploads and items; the payer can restore, a participant cannot", async () => {
    as(tokenB); // Bob (participant) voids Alice's expense — allowed
    await swallow(actions.deleteExpenseForm(form({ expenseId })));
    const voided = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(voided.voidedAt).toBeTruthy();
    expect(voided.voidedById).toBe(bob.id);
    as(tokenA);
    await expect(actions.uploadReceipt(expenseId, "receipt.png", PNG, "image/png")).rejects.toThrow(/voided/);
    await expect(actions.addItemForm(form({ expenseId, description: "tip", amount: "1.00" }))).rejects.toThrow(/voided/);
    as(tokenB);
    await expect(actions.restoreExpenseForm(form({ expenseId }))).rejects.toThrow(/only the payer/);
    as(tokenA);
    await swallow(actions.restoreExpenseForm(form({ expenseId })));
    const restored = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(restored.voidedAt).toBeNull();
    const act = await prisma.activity.findFirst({ where: { type: "expense_restored", userId: alice.id }, orderBy: { createdAt: "desc" } });
    expect(act).toBeTruthy();
  }, 30000);

  it("R6: voiding a CONFIRMED settlement needs the other party; it counts until they agree", async () => {
    as(tokenA);
    await swallow(actions.recordSettlementForm(form({ fromUserId: bob.id, toUserId: alice.id, amount: "50.00", back: "/dashboard" })));
    const s = await prisma.settlement.findFirst({ where: { fromUserId: bob.id, toUserId: alice.id }, orderBy: { createdAt: "desc" } });
    expect(s.status).toBe("PENDING");
    as(tokenB); // Bob confirms his payment
    await swallow(actions.confirmSettlementForm(form({ settlementId: s.id, back: "/dashboard" })));
    const confirmed = await prisma.settlement.findUnique({ where: { id: s.id } });
    expect(confirmed.status).toBe("CONFIRMED");
    // Alice asks to void: becomes a request, still counts.
    as(tokenA);
    await swallow(actions.voidSettlementForm(form({ settlementId: s.id, back: "/dashboard" })));
    const requested = await prisma.settlement.findUnique({ where: { id: s.id } });
    expect(requested.status).toBe("VOID_REQUESTED");
    expect(requested.voidRequestedById).toBe(alice.id);
    expect(balances.netBetween(alice.id, bob.id, [], [requested])).toBe(-5000);
    // Alice cannot agree to her own request.
    await expect(actions.confirmVoidSettlementForm(form({ settlementId: s.id, back: "/dashboard" }))).rejects.toThrow(/your own void request/);
    // Bob declines: back to CONFIRMED.
    as(tokenB);
    await swallow(actions.rejectVoidSettlementForm(form({ settlementId: s.id, back: "/dashboard" })));
    expect((await prisma.settlement.findUnique({ where: { id: s.id } })).status).toBe("CONFIRMED");
    // Round two: Alice requests again, Bob agrees — now it stops counting.
    as(tokenA);
    await swallow(actions.voidSettlementForm(form({ settlementId: s.id, back: "/dashboard" })));
    as(tokenB);
    await swallow(actions.confirmVoidSettlementForm(form({ settlementId: s.id, back: "/dashboard" })));
    const voidedS = await prisma.settlement.findUnique({ where: { id: s.id } });
    expect(voidedS.status).toBe("VOIDED");
    expect(balances.netBetween(alice.id, bob.id, [], [voidedS])).toBe(0);
  }, 30000);

  it("R6: pending settlements per pair are capped", async () => {
    for (let i = 0; i < 10; i++) {
      await prisma.settlement.create({
        data: { fromUserId: bob.id, toUserId: alice.id, amountInCents: 100, status: "PENDING", recordedById: alice.id },
      });
    }
    as(tokenA);
    await expect(actions.recordSettlementForm(form({ fromUserId: bob.id, toUserId: alice.id, amount: "1.00", back: "/dashboard" })))
      .rejects.toThrow(/too many unconfirmed/);
  }, 30000);
});
