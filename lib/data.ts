import { prisma } from "./db";
import { normalizePair } from "./friends";

// Scoped data access: every helper here takes the SESSION user's id and only
// returns data that user is entitled to see. Pages/actions must never query
// by a client-supplied user id for identity.

export async function getFriendships(userId: string) {
  return prisma.friendship.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    include: { userA: true, userB: true },
    orderBy: { createdAt: "asc" },
  });
}

/** The other side of each of my friendships. */
export async function getFriends(userId: string) {
  const friendships = await getFriendships(userId);
  return friendships.map((f) => (f.userAId === userId ? f.userB : f.userA));
}

export async function findFriendship(userId: string, otherId: string) {
  const [a, b] = normalizePair(userId, otherId);
  return prisma.friendship.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } });
}

export async function areFriends(userId: string, otherId: string): Promise<boolean> {
  return !!(await findFriendship(userId, otherId));
}

/** Find a user by email or create a placeholder (shadow) account for them. */
export async function resolveUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) return { user: existing, createdPlaceholder: false };
  const { placeholderName } = await import("./friends");
  const user = await prisma.user.create({
    data: { name: placeholderName(normalized), email: normalized, isPlaceholder: true, passwordHash: null },
  });
  return { user, createdPlaceholder: true };
}

/** All expenses I participate in (paid by me, or I have a split), with splits. */
export async function getMyExpenses(userId: string) {
  return prisma.expense.findMany({
    where: { OR: [{ paidById: userId }, { splits: { some: { userId } } }] },
    include: { splits: { include: { user: true } }, paidBy: true, group: true },
    orderBy: { date: "desc" },
  });
}

/** All settlements I am a party to. */
export async function getMySettlements(userId: string) {
  return prisma.settlement.findMany({
    where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
    include: { fromUser: true, toUser: true, group: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getMyGroups(userId: string) {
  return prisma.group.findMany({
    where: { members: { some: { userId } } },
    include: { members: { include: { user: true } }, expenses: { include: { splits: true } }, settlements: true },
    orderBy: { createdAt: "desc" },
  });
}

/** A group only if I am a member — otherwise null (callers 404). */
export async function getMyGroup(userId: string, groupId: string) {
  return prisma.group.findFirst({
    where: { id: groupId, members: { some: { userId } } },
    include: {
      members: { include: { user: true } },
      expenses: { include: { splits: true, paidBy: true, items: true }, orderBy: { date: "desc" } },
      settlements: { include: { fromUser: true, toUser: true }, orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
      tripPasses: true,
    },
  });
}

/** An expense only if I participate in it — otherwise null (callers 404). */
export async function getMyExpense(userId: string, expenseId: string) {
  return prisma.expense.findFirst({
    where: { id: expenseId, OR: [{ paidById: userId }, { splits: { some: { userId } } }] },
    include: {
      receipt: true,
      items: { include: { assignedTo: true } },
      paidBy: true,
      splits: { include: { user: true } },
      group: { include: { members: { include: { user: true } } } },
    },
  });
}
