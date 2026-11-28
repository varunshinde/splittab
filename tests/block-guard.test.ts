import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";

// N4 (re-audit): a block belongs to its creator. The blocked party can
// neither delete the BLOCKED row (removeFriendForm) nor overwrite it with
// their own block (blockUserForm). The blocker can still remove it.
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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.24" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const hasDb = !!process.env.DATABASE_URL;
const run = hasDb ? describe : describe.skip;

run("N4: block ownership guards (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, actions: any, authUtils: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let victim: any, mallory: any;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  let tokenV = "", tokenM = "";
  const row = () => prisma.friendship.findFirst({
    where: { OR: [
      { userAId: victim.id, userBId: mallory.id },
      { userAId: mallory.id, userBId: victim.id },
    ] },
  });

  beforeAll(async () => {
    prisma = (await import("../lib/db")).prisma;
    actions = await import("../app/actions");
    authUtils = await import("../lib/auth-utils");
    victim = await prisma.user.create({ data: { name: "Victim", email: `n4-victim-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    mallory = await prisma.user.create({ data: { name: "Mallory", email: `n4-mallory-${suffix}@example.com`, passwordHash: "x", emailVerifiedAt: new Date() } });
    tokenV = authUtils.generateSessionToken();
    tokenM = authUtils.generateSessionToken();
    await prisma.session.createMany({ data: [
      { tokenHash: authUtils.hashToken(tokenV), userId: victim.id, expiresAt: authUtils.sessionExpiry() },
      { tokenHash: authUtils.hashToken(tokenM), userId: mallory.id, expiresAt: authUtils.sessionExpiry() },
    ] });
  }, 60000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [victim.id, mallory.id] } } }).catch(() => {});
    await prisma.$disconnect();
  }, 60000);

  it("victim blocks Mallory", async () => {
    jar.set("session", tokenV);
    await expect(actions.blockUserForm(form({ friendId: mallory.id }))).rejects.toThrow(/NEXT_REDIRECT/);
    const r = await row();
    expect(r.status).toBe("BLOCKED");
    expect(r.blockedById).toBe(victim.id);
  });

  it("the blocked party CANNOT delete the block via removeFriendForm", async () => {
    jar.set("session", tokenM);
    await expect(actions.removeFriendForm(form({ friendId: victim.id }))).rejects.toThrow(/NEXT_REDIRECT/);
    const r = await row();
    expect(r).not.toBeNull();
    expect(r.status).toBe("BLOCKED");
    expect(r.blockedById).toBe(victim.id);
  });

  it("the blocked party CANNOT overwrite the block with their own", async () => {
    jar.set("session", tokenM);
    await expect(actions.blockUserForm(form({ friendId: victim.id }))).rejects.toThrow(/NEXT_REDIRECT/);
    const r = await row();
    expect(r.status).toBe("BLOCKED");
    expect(r.blockedById).toBe(victim.id);
  });

  it("the blocker CAN remove their own block (unblock still works)", async () => {
    jar.set("session", tokenV);
    await expect(actions.removeFriendForm(form({ friendId: mallory.id }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await row()).toBeNull();
  });
});
