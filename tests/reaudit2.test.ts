import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// Re-audit 2: R1 (structured activity), R2 (export leaks group ledger to
// invitees), R3 (friend page as name lookup for PENDING requests).
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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.30" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("Re-audit 2: R1/R2/R3 (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, actions: any, authUtils: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let owner: any, invitee: any, guest: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const marker = `LedgerSecret-${suffix}`;
  let groupId = "";
  let tokenO = "", tokenI = "";
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    actions = await import("../app/actions");
    authUtils = await import("../lib/auth-utils");
    owner = await prisma.user.create({ data: { name: "Owner", email: `r2-owner-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    invitee = await prisma.user.create({ data: { name: "Invitee", email: `r2-invitee-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    guest = await prisma.user.create({ data: { name: "Guest", email: `r1-guest-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    tokenO = authUtils.generateSessionToken();
    tokenI = authUtils.generateSessionToken();
    await prisma.session.createMany({ data: [
      { tokenHash: authUtils.hashToken(tokenO), userId: owner.id, expiresAt: authUtils.sessionExpiry() },
      { tokenHash: authUtils.hashToken(tokenI), userId: invitee.id, expiresAt: authUtils.sessionExpiry() },
    ] });
    jar.set("session", tokenO);
    try {
      await actions.createGroupForm(form({ name: "R2 Group", type: "trip", baseCurrency: "USD", inviteEmails: invitee.email }));
    } catch { /* redirect */ }
    const g = await prisma.group.findFirst({ where: { name: "R2 Group", members: { some: { userId: owner.id } } }, orderBy: { createdAt: "desc" } });
    groupId = g.id;
    // A group expense whose description must never reach the invitee.
    await prisma.expense.create({
      data: {
        groupId, description: marker, amountInCents: 5000, paidById: owner.id,
        splits: { create: [{ userId: owner.id, amountOwedInCents: 5000 }] },
      },
    });
  }, 60000);

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: groupId } }).catch(() => {});
    await prisma.friendship.deleteMany({ where: { OR: [{ userAId: owner.id }, { userBId: owner.id }] } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, invitee.id, guest.id] } } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("R1: the member_invited activity stores the invitee id — no email in the text", async () => {
    jar.set("session", tokenO);
    try {
      await actions.addGroupMemberForm(form({ groupId, email: guest.email }));
    } catch { /* redirect */ }
    const a = await prisma.activity.findFirst({ where: { groupId, type: "member_invited" }, orderBy: { createdAt: "desc" } });
    expect(a).toBeTruthy();
    expect(a.subjectId).toBe(guest.id);
    expect(a.data).not.toBeNull();
    expect(a.message).not.toContain(guest.email);
    expect(a.message).not.toContain(guest.name);
  }, 30000);

  it("R2: an INVITED (never accepted) user's export contains none of the group's ledger", async () => {
    jar.set("session", tokenI);
    const data = await actions.exportData();
    const text = JSON.stringify(data);
    expect(text).not.toContain(marker);
    expect(text).not.toContain(groupId);
  }, 30000);

  it("R3: the friend page 404s for a PENDING request and opens once ACCEPTED", async () => {
    const [a, b] = owner.id < invitee.id ? [owner.id, invitee.id] : [invitee.id, owner.id];
    await prisma.friendship.create({ data: { userAId: a, userBId: b, status: "PENDING", requestedById: owner.id } });
    const FriendPage = (await import("../app/friends/[id]/page")).default;
    jar.set("session", tokenO);
    await expect(FriendPage({ params: Promise.resolve({ id: invitee.id }), searchParams: Promise.resolve({}) }))
      .rejects.toThrow(/NEXT_NOT_FOUND/);
    await prisma.friendship.update({ where: { userAId_userBId: { userAId: a, userBId: b } }, data: { status: "ACCEPTED" } });
    const el = await FriendPage({ params: Promise.resolve({ id: invitee.id }), searchParams: Promise.resolve({}) });
    expect(el).toBeTruthy();
  }, 30000);
});
