import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// Itemization v2: multi-person item assignment, itemized splits driving
// the expense's shares, receipt upload form, item deletion.
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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.41" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

describe("itemizedSplits (pure)", () => {
  it("splits items among assignees, unassigned across everyone, remainder equally", async () => {
    const { itemizedSplits } = await import("../lib/splits");
    const shares = itemizedSplits(9400, [
      { amountInCents: 1800, assignedToUserIds: ["bob"] },
      { amountInCents: 3200, assignedToUserIds: [] },
    ], ["alice", "bob", "carol"]);
    const by = Object.fromEntries(shares.map((s) => [s.userId, s.amountOwedInCents]));
    // item2 3200/3 -> 1067/1067/1066; remainder 4400/3 -> 1467/1467/1466
    expect(by.alice).toBe(1067 + 1467);
    expect(by.bob).toBe(1800 + 1067 + 1467);
    expect(by.carol).toBe(1066 + 1466);
    expect(shares.reduce((a, s) => a + s.amountOwedInCents, 0)).toBe(9400);
  });

  it("throws when items exceed the total", async () => {
    const { itemizedSplits } = await import("../lib/splits");
    expect(() => itemizedSplits(1000, [{ amountInCents: 1001, assignedToUserIds: [] }], ["alice"])).toThrow(/exceeds/);
  });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 7)]);

run("Itemization v2 (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, actions: any, authUtils: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let alice: any, bob: any, carol: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  let tokenA = "", tokenB = "";
  let expenseId = "", expense2Id = "";
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
    alice = await prisma.user.create({ data: { name: "Alice", email: `iv2-alice-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    bob = await prisma.user.create({ data: { name: "Bob", email: `iv2-bob-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    carol = await prisma.user.create({ data: { name: "Carol", email: `iv2-carol-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    tokenA = authUtils.generateSessionToken();
    tokenB = authUtils.generateSessionToken();
    await prisma.session.createMany({ data: [
      { tokenHash: authUtils.hashToken(tokenA), userId: alice.id, expiresAt: authUtils.sessionExpiry() },
      { tokenHash: authUtils.hashToken(tokenB), userId: bob.id, expiresAt: authUtils.sessionExpiry() },
    ] });
    const mk = async (desc: string) => prisma.expense.create({
      data: {
        description: desc, amountInCents: 9400, paidById: alice.id,
        splits: { create: [
          { userId: alice.id, amountOwedInCents: 3134 },
          { userId: bob.id, amountOwedInCents: 3133 },
          { userId: carol.id, amountOwedInCents: 3133 },
        ] },
      },
    });
    expenseId = (await mk(`iv2 dinner ${suffix}`)).id;
    expense2Id = (await mk(`iv2 apply ${suffix}`)).id;
  }, 60000);

  afterAll(async () => {
    await prisma.expense.deleteMany({ where: { id: { in: [expenseId, expense2Id] } } }).catch(() => {});
    await prisma.activity.deleteMany({ where: { userId: { in: [alice.id, bob.id, carol.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, carol.id] } } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("addItemForm: multi-person assignment via checkboxes; non-participants filtered", async () => {
    as(tokenA);
    const fd = form({ expenseId, description: "Hummus", amount: "28.00" });
    fd.append("assignedToUserIds", bob.id);
    fd.append("assignedToUserIds", carol.id);
    fd.append("assignedToUserIds", "not-a-participant");
    await swallow(actions.addItemForm(fd));
    const item = await prisma.expenseItem.findFirst({ where: { expenseId, description: "Hummus" } });
    expect(item).toBeTruthy();
    expect([...item.assignedToUserIds].sort()).toEqual([bob.id, carol.id].sort());
    expect(item.assignedToUserId).toBeNull();
  }, 30000);

  it("addItemForm: legacy single assignment still lands in the array", async () => {
    as(tokenA);
    await swallow(actions.addItemForm(form({ expenseId, description: "Paloma", amount: "22.00", assignedToUserId: bob.id })));
    const item = await prisma.expenseItem.findFirst({ where: { expenseId, description: "Paloma" } });
    expect(item.assignedToUserIds).toEqual([bob.id]);
    expect(item.assignedToUserId).toBe(bob.id);
  }, 30000);

  it("deleteItemForm: a participant can remove an item", async () => {
    const item = await prisma.expenseItem.findFirst({ where: { expenseId, description: "Paloma" } });
    as(tokenB);
    await swallow(actions.deleteItemForm(form({ expenseId, itemId: item.id })));
    expect(await prisma.expenseItem.findUnique({ where: { id: item.id } })).toBeNull();
  }, 30000);

  it("uploadReceiptForm: payer uploads a receipt photo through the form", async () => {
    as(tokenA);
    const fd = new FormData();
    fd.set("expenseId", expenseId);
    fd.set("receipt", new File([PNG], "receipt.png", { type: "image/png" }));
    await expect(actions.uploadReceiptForm(fd)).rejects.toThrow(/receipt_uploaded/);
    const e = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(e.receiptId).toBeTruthy();
  }, 30000);

  it("applyItemizationForm: payer-only; rewrites splits from items + equal remainder", async () => {
    await prisma.expenseItem.createMany({ data: [
      { expenseId: expense2Id, description: "Shawarma", amountInCents: 2300, assignedToUserIds: [alice.id, bob.id] },
      { expenseId: expense2Id, description: "Garlic shrimp", amountInCents: 2700, assignedToUserIds: [] },
    ] });
    as(tokenB);
    await expect(actions.applyItemizationForm(form({ expenseId: expense2Id }))).rejects.toThrow(/only the payer/);
    as(tokenA);
    await expect(actions.applyItemizationForm(form({ expenseId: expense2Id }))).rejects.toThrow(/itemization_applied/);
    const splits = await prisma.expenseSplit.findMany({ where: { expenseId: expense2Id } });
    const by = Object.fromEntries(splits.map((s: { userId: string; amountOwedInCents: number }) => [s.userId, s.amountOwedInCents]));
    // 2300/2 = 1150 (alice, bob); 2700/3 = 900 each; remainder 4400/3 = 1467/1467/1466
    expect(by[alice.id]).toBe(1150 + 900 + 1467);
    expect(by[bob.id]).toBe(1150 + 900 + 1467);
    expect(by[carol.id]).toBe(900 + 1466);
    expect(splits.reduce((a: number, s: { amountOwedInCents: number }) => a + s.amountOwedInCents, 0)).toBe(9400);
    const act = await prisma.activity.findFirst({ where: { type: "expense_itemized", userId: alice.id }, orderBy: { createdAt: "desc" } });
    expect(act).toBeTruthy();
  }, 30000);

  it("applyItemizationForm: items over the total redirect to an error and change nothing", async () => {
    await prisma.expenseItem.create({ data: { expenseId: expense2Id, description: "Too much", amountInCents: 999999, assignedToUserIds: [] } });
    as(tokenA);
    await expect(actions.applyItemizationForm(form({ expenseId: expense2Id }))).rejects.toThrow(/items_exceed_total/);
    const splits = await prisma.expenseSplit.findMany({ where: { expenseId: expense2Id } });
    expect(splits.reduce((a: number, s: { amountOwedInCents: number }) => a + s.amountOwedInCents, 0)).toBe(9400);
    const carolSplit = splits.find((s: { userId: string }) => s.userId === carol.id);
    expect(carolSplit.amountOwedInCents).toBe(900 + 1466);
  }, 30000);
});
