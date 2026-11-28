import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// Re-audit 2: R8 (Settings password throttle), R10 (sticky decline),
// R11 (blocked-invite masking + friend-mode pairwise consent).
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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.50" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("../lib/mail", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, dev: true })),
  getAppUrl: () => "http://localhost:3000",
  verificationEmailHtml: (link: string) => link,
  resetEmailHtml: (link: string) => link,
  existingAccountEmailHtml: () => "existing-account notice",
  deviceCodeEmailHtml: (code: string) => code,
  newSigninAlertEmailHtml: () => "signin-alert",
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("Re-audit 2: R8/R10/R11 (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, actions: any, authActions: any, authUtils: any, data: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let owner: any, victim: any, carol: any, dave: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const PASSWORD = "Settings-Pass-2026!";
  let tokenO = "", tokenV = "", tokenC = "", tokenD = "";
  const groupIds: string[] = [];
  const form = (fields: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
      else fd.set(k, v);
    }
    return fd;
  };
  const as = (t: string) => jar.set("session", t);
  const redirectOf = async (p: Promise<unknown>) => {
    try { await p; return ""; } catch (e) { return (e as Error).message; }
  };
  const befriend = async (x: string, y: string) => {
    const [a, b] = x < y ? [x, y] : [y, x];
    await prisma.friendship.create({ data: { userAId: a, userBId: b, status: "ACCEPTED", requestedById: x } });
  };

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    actions = await import("../app/actions");
    authActions = await import("../app/auth-actions");
    authUtils = await import("../lib/auth-utils");
    data = await import("../lib/data");
    const mk = async (name: string, tag: string) => prisma.user.create({
      data: { name, email: `r8-${tag}-${suffix}@example.com`, passwordHash: await authUtils.hashPassword(PASSWORD), emailVerifiedAt: new Date() },
    });
    owner = await mk("Owner", "owner");
    victim = await mk("Victim", "victim");
    carol = await mk("Carol", "carol");
    dave = await mk("Dave", "dave");
    const tokens: Record<string, string> = {};
    for (const u of [owner, victim, carol, dave]) {
      const t = authUtils.generateSessionToken();
      tokens[u.id] = t;
      await prisma.session.create({ data: { tokenHash: authUtils.hashToken(t), userId: u.id, expiresAt: authUtils.sessionExpiry() } });
    }
    tokenO = tokens[owner.id]; tokenV = tokens[victim.id]; tokenC = tokens[carol.id]; tokenD = tokens[dave.id];
  }, 60000);

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: { in: groupIds } } }).catch(() => {});
    const ids = [owner.id, victim.id, carol.id, dave.id];
    await prisma.friendship.deleteMany({ where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { email: { in: [owner.email, victim.email, carol.email, dave.email] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("R8: five wrong current-passwords in Settings lock the sixth — even the right one, for both actions", async () => {
    as(tokenO);
    for (let i = 0; i < 5; i++) {
      const url = await redirectOf(authActions.changePasswordAction(form({ currentPassword: "wrong-guess", newPassword: "Whatever-New-2026!" })));
      expect(url).toContain("error=current_password_wrong");
    }
    const sixth = await redirectOf(authActions.changePasswordAction(form({ currentPassword: PASSWORD, newPassword: "Whatever-New-2026!" })));
    expect(sixth).toContain("error=too_many_attempts");
    // The same counter guards account deletion.
    const del = await redirectOf(authActions.deleteAccountAction(form({ current_password: PASSWORD })));
    expect(del).toContain("error=too_many_attempts");
    const u = await prisma.user.findUnique({ where: { id: owner.id } });
    expect(u.passwordHash).toBeTruthy(); // nothing changed
    expect(u.email).toBe(owner.email); // not tombstoned
  }, 60000);

  it("R10: after a decline, re-inviting to the same group is refused and the row stays DECLINED", async () => {
    as(tokenV);
    const url = await redirectOf(actions.createGroupForm(form({ name: "R10 Group", type: "trip", baseCurrency: "USD", inviteEmails: "" })));
    const gid = url.replace("NEXT_REDIRECT /groups/", "");
    groupIds.push(gid);
    // Victim owns the group here; instead have Dave own a group and invite victim.
    as(tokenD);
    const url2 = await redirectOf(actions.createGroupForm(form({ name: "R10 Group Two", type: "trip", baseCurrency: "USD", inviteEmails: victim.email })));
    const gid2 = url2.replace("NEXT_REDIRECT /groups/", "");
    groupIds.push(gid2);
    as(tokenV);
    await redirectOf(actions.declineGroupInviteForm(form({ groupId: gid2 })));
    expect((await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: victim.id, groupId: gid2 } } })).status).toBe("DECLINED");
    as(tokenD);
    const reinvite = await redirectOf(actions.addGroupMemberForm(form({ groupId: gid2, email: victim.email })));
    expect(reinvite).toContain("error=member_previously_declined");
    expect((await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: victim.id, groupId: gid2 } } })).status).toBe("DECLINED");
  }, 60000);

  it("R11: a blocked inviter's invitation is recorded but never surfaced to the invitee", async () => {
    // Carol blocks Dave.
    as(tokenC);
    await redirectOf(actions.blockUserForm(form({ friendId: dave.id })));
    // Dave creates a group inviting Carol: a suppressed row appears.
    as(tokenD);
    const url = await redirectOf(actions.createGroupForm(form({ name: "R11 Trap", type: "trip", baseCurrency: "USD", inviteEmails: carol.email })));
    const gid = url.replace("NEXT_REDIRECT /groups/", "");
    groupIds.push(gid);
    const row = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: carol.id, groupId: gid } } });
    expect(row.status).toBe("INVITED");
    expect(row.inviteSuppressed).toBe(true);
    // Carol sees no invitation and gets no group access.
    expect((await data.getGroupInvitations(carol.id)).some((i: { group: { id: string } }) => i.group.id === gid)).toBe(false);
    expect(await data.getMyGroup(carol.id, gid)).toBeNull();
    // Carol cannot accept it by posting the form directly either.
    as(tokenC);
    await expect(actions.acceptGroupInviteForm(form({ groupId: gid }))).rejects.toThrow(/no pending invitation/);
    // Dave's view is indistinguishable from a normal pending invite.
    const davesGroup = await data.getMyGroup(dave.id, gid);
    expect(davesGroup.members.some((m: { userId: string; status: string }) => m.userId === carol.id && m.status === "INVITED")).toBe(true);
  }, 60000);

  it("R11: a friend expense cannot put two of my friends (not friends with each other) in one ledger", async () => {
    await befriend(owner.id, victim.id);
    await befriend(owner.id, carol.id);
    // victim and carol are NOT friends with each other.
    as(tokenO);
    await expect(actions.addExpenseForm(form({
      context: "friends", description: "R11 trap", amount: "30.00", currency: "USD",
      paidById: victim.id, participantIds: [victim.id, carol.id],
    }))).rejects.toThrow(/friends with each other/);
    // Control: an ordinary expense between me and one friend works.
    const ok = await redirectOf(actions.addExpenseForm(form({
      context: "friends", description: "R11 fine", amount: "30.00", currency: "USD",
      paidById: owner.id, participantIds: [owner.id, victim.id],
    })));
    expect(ok).toContain("/dashboard");
  }, 60000);
});
