import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// N2 (re-audit): group membership is an INVITATION the invitee accepts.
// Before acceptance: no membership, no friendship, no splits, no debt —
// closing the bypass that undid the F1 consent fix.
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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.25" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("N2: group invitations require acceptance (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, actions: any, authUtils: any, data: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mallory: any, victim: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const ghostEmail = `n2-ghost-${suffix}@example.com`;
  const form = (fields: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
      else fd.set(k, v);
    }
    return fd;
  };
  let tokenM = "", tokenV = "";
  let groupId = "";

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    actions = await import("../app/actions");
    data = await import("../lib/data");
    authUtils = await import("../lib/auth-utils");
    mallory = await prisma.user.create({ data: { name: "Mallory", email: `n2-mallory-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    victim = await prisma.user.create({ data: { name: "Victim", email: `n2-victim-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    tokenM = authUtils.generateSessionToken();
    tokenV = authUtils.generateSessionToken();
    await prisma.session.createMany({ data: [
      { tokenHash: authUtils.hashToken(tokenM), userId: mallory.id, expiresAt: authUtils.sessionExpiry() },
      { tokenHash: authUtils.hashToken(tokenV), userId: victim.id, expiresAt: authUtils.sessionExpiry() },
    ] });
  }, 60000);

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: groupId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [mallory.id, victim.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: ghostEmail } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("creating a group invites — it does NOT make the victim a member or friend", async () => {
    jar.set("session", tokenM);
    let redirectUrl = "";
    try {
      await actions.createGroupForm(form({ name: "Trap Group", type: "trip", baseCurrency: "USD", inviteEmails: victim.email }));
    } catch (e) { redirectUrl = (e as Error).message; }
    groupId = redirectUrl.replace("NEXT_REDIRECT /groups/", "");
    expect(groupId).toBeTruthy();
    const membership = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: victim.id, groupId } } });
    expect(membership.status).toBe("INVITED");
    expect(membership.invitedById).toBe(mallory.id);
    const friendship = await prisma.friendship.findFirst({ where: { OR: [{ userAId: mallory.id, userBId: victim.id }, { userAId: victim.id, userBId: mallory.id }] } });
    expect(friendship?.status ?? null).not.toBe("ACCEPTED");
    // The group is not in the victim's group list; it IS in invitations.
    expect((await data.getMyGroups(victim.id)).map((g: { id: string }) => g.id)).not.toContain(groupId);
    const invites = await data.getGroupInvitations(victim.id);
    expect(invites.map((i: { group: { id: string } }) => i.group.id)).toContain(groupId);
    expect(invites[0].invitedByName).toBe("Mallory");
  });

  it("an invited user cannot be put on a group expense or a friend expense", async () => {
    jar.set("session", tokenM);
    await actions.addGroupExpenseForm(form({
      groupId, description: "Trap dinner", amount: "100.00", currency: "USD", category: "Food",
      paidById: mallory.id, participantIds: [mallory.id, victim.id], mode: "equal",
    })).catch(() => {});
    const splits = await prisma.expenseSplit.findMany({ where: { userId: victim.id, expense: { groupId } } });
    expect(splits.length).toBe(0);
    await expect(actions.addExpenseForm(form({
      context: "friends", description: "Trap loan", amount: "10.00", currency: "USD",
      paidById: mallory.id, participantIds: [victim.id],
    }))).rejects.toThrow(/not in scope|NEXT_REDIRECT/);
  });

  it("accepting makes them a member AND friends with the inviter", async () => {
    jar.set("session", tokenV);
    await expect(actions.acceptGroupInviteForm(form({ groupId }))).rejects.toThrow(/NEXT_REDIRECT/);
    const membership = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: victim.id, groupId } } });
    expect(membership.status).toBe("MEMBER");
    const friendship = await prisma.friendship.findFirst({ where: { OR: [{ userAId: mallory.id, userBId: victim.id }, { userAId: victim.id, userBId: mallory.id }] } });
    expect(friendship.status).toBe("ACCEPTED");
    expect((await data.getMyGroups(victim.id)).map((g: { id: string }) => g.id)).toContain(groupId);
  });

  it("declining removes the invitation entirely; inviting an unregistered email creates an INVITED placeholder with no debt", async () => {
    jar.set("session", tokenM);
    await expect(actions.addGroupMemberForm(form({ groupId, email: ghostEmail }))).rejects.toThrow(/NEXT_REDIRECT/);
    const ghost = await prisma.user.findUnique({ where: { email: ghostEmail } });
    expect(ghost.isPlaceholder).toBe(true);
    const gm = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: ghost.id, groupId } } });
    expect(gm.status).toBe("INVITED");
    // The ghost cannot be charged either.
    await actions.addGroupExpenseForm(form({
      groupId, description: "Ghost dinner", amount: "50.00", currency: "USD", category: "Food",
      paidById: mallory.id, participantIds: [mallory.id, ghost.id], mode: "equal",
    })).catch(() => {});
    expect(await prisma.expenseSplit.count({ where: { userId: ghost.id } })).toBe(0);
    // Decline as the victim on a fresh invite from a second group.
    let url2 = "";
    try {
      await actions.createGroupForm(form({ name: "Second Group", type: "trip", baseCurrency: "USD", inviteEmails: victim.email }));
    } catch (e) { url2 = (e as Error).message; }
    const group2 = url2.replace("NEXT_REDIRECT /groups/", "");
    jar.set("session", tokenV);
    await expect(actions.declineGroupInviteForm(form({ groupId: group2 }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: victim.id, groupId: group2 } } })).toBeNull();
    await prisma.group.deleteMany({ where: { id: group2 } }).catch(() => {});
  }, 30000);
});
