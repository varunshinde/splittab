"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { computeSplit, itemizedSplits } from "@/lib/splits";
import { netBetween } from "@/lib/balances";
import { assertCanUpload, canGrantTripPass, tripPassExpiry } from "@/lib/pro";
import { storage } from "@/lib/storage";
import { ocrReceipt } from "@/lib/ocr";
import { decideAddFriend, isValidEmail, normalizeEmail, normalizePair } from "@/lib/friends";
import { checkActionThrottle, clientIp, recordAction } from "@/lib/ratelimit";
import { flashUrl } from "@/lib/flash";
import { areFriends, findFriendship, getMyExpense, resolveUserByEmail } from "@/lib/data";
import {
  assertValidUpload, capString, parseAmountCents, parseCurrency, parseDate, requireString, safeBackPath,
  MAX_CATEGORY_LEN, MAX_DESCRIPTION_LEN, MAX_GROUP_INVITEES, MAX_GROUP_NAME_LEN, MAX_NOTES_LEN, MAX_NAME_LEN,
} from "@/lib/validate";

// ---------------------------------------------------------------------------
// Security rule for this whole file: identity ALWAYS comes from the session
// (requireUser). No action accepts a userId from the client as "who I am".
// Client-supplied ids are only ever *targets* (payer, participants, friend)
// and are validated against the session user's groups/friendships.
// ---------------------------------------------------------------------------

function parseAmountToCents(raw: FormDataEntryValue | null): number {
  return parseAmountCents(raw);
}

/** Group co-membership implies an ACCEPTED friendship (Splitwise model).
 *  Never resurrects a BLOCKED pair: returns false when a block exists. */
async function befriend(userId: string, otherId: string): Promise<boolean> {
  const [a, b] = normalizePair(userId, otherId);
  const existing = await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } });
  if (existing?.status === "BLOCKED") return false;
  await prisma.friendship.upsert({
    where: { userAId_userBId: { userAId: a, userBId: b } },
    create: { userAId: a, userBId: b, status: "ACCEPTED" },
    update: { status: "ACCEPTED" },
  });
  return true;
}

/** True when `otherId` has blocked `userId` (they must not be re-added). */
async function blockedBy(userId: string, otherId: string): Promise<boolean> {
  const f = await findFriendship(userId, otherId);
  return f?.status === "BLOCKED" && f.blockedById === otherId;
}

// --- Friends ---------------------------------------------------------------

export async function addFriendForm(formData: FormData) {
  const me = await requireUser();
  if (await checkActionThrottle("friend_add", me.email)) {
    redirect(flashUrl("/friends", "error", "friend_add_throttled"));
  }
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const existing = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  const friendship = existing ? await findFriendship(me.id, existing.id) : null;
  const decision = decideAddFriend({
    myId: me.id,
    myEmail: me.email,
    email,
    existingUser: existing ? { id: existing.id, email: existing.email, isPlaceholder: existing.isPlaceholder } : null,
    friendship: friendship ? { status: friendship.status, requestedById: friendship.requestedById } : null,
  });
  if (decision.kind === "invalid-email") redirect(flashUrl("/friends", "error", "invalid_email"));
  if (decision.kind === "self") redirect(flashUrl("/friends", "error", "own_email"));
  if (decision.kind === "already-friends") redirect(flashUrl("/friends", "notice", "already_friends"));
  if (decision.kind === "accept-theirs") {
    await prisma.friendship.update({ where: { id: friendship!.id }, data: { status: "ACCEPTED" } });
    await recordAction("friend_add", me.email, clientIp(await headers()));
    revalidatePath("/friends");
    redirect(flashUrl("/friends", "notice", "friend_request_accepted"));
  }
  // F1 + F3: sending a request. The outcome message is IDENTICAL whether
  // the target is a registered user, a brand-new placeholder, an already
  // pending request, or a pair with a block (which silently no-ops) — the
  // response never reveals which case it was.
  const sent = flashUrl("/friends", "notice", "friend_request_sent");
  if (decision.kind === "blocked" || decision.kind === "already-requested") {
    redirect(sent);
  }
  const targetId = decision.kind === "request-existing" ? decision.userId : (await resolveUserByEmail(email)).user.id;
  const [a, b] = normalizePair(me.id, targetId);
  await prisma.friendship.upsert({
    where: { userAId_userBId: { userAId: a, userBId: b } },
    create: { userAId: a, userBId: b, status: "PENDING", requestedById: me.id },
    update: {},
  });
  await recordAction("friend_add", me.email, clientIp(await headers()));
  revalidatePath("/friends");
  redirect(sent);
}

/** Accept an incoming friend request (they asked me). */
export async function acceptFriendForm(formData: FormData) {
  const me = await requireUser();
  const friendId = String(formData.get("friendId") ?? "");
  const friendship = await findFriendship(me.id, friendId);
  if (friendship && friendship.status === "PENDING" && friendship.requestedById === friendId) {
    await prisma.friendship.update({ where: { id: friendship.id }, data: { status: "ACCEPTED" } });
  }
  revalidatePath("/friends");
  redirect("/friends");
}

/** Decline an incoming friend request: the row is deleted. */
export async function declineFriendForm(formData: FormData) {
  const me = await requireUser();
  const friendId = String(formData.get("friendId") ?? "");
  const friendship = await findFriendship(me.id, friendId);
  if (friendship && friendship.status === "PENDING" && friendship.requestedById === friendId) {
    await prisma.friendship.delete({ where: { id: friendship.id } });
  }
  revalidatePath("/friends");
  redirect("/friends");
}

/** Withdraw an outgoing friend request I sent. */
export async function cancelFriendRequestForm(formData: FormData) {
  const me = await requireUser();
  const friendId = String(formData.get("friendId") ?? "");
  const friendship = await findFriendship(me.id, friendId);
  if (friendship && friendship.status === "PENDING" && friendship.requestedById === me.id) {
    await prisma.friendship.delete({ where: { id: friendship.id } });
  }
  revalidatePath("/friends");
  redirect("/friends");
}

/** Block a user: ends any friendship/request and silently prevents them
 *  from re-adding me (friend requests and group adds no-op). Unblocking is
 *  the Remove button (deletes the row). */
export async function blockUserForm(formData: FormData) {
  const me = await requireUser();
  const friendId = String(formData.get("friendId") ?? "");
  if (friendId && friendId !== me.id) {
    const target = await prisma.user.findUnique({ where: { id: friendId }, select: { id: true } });
    if (target) {
      const existing = await findFriendship(me.id, friendId);
      // N4: never overwrite a block the OTHER person created — a BLOCKED
      // row already blocks both directions, and replacing blockedById
      // would hand control of the block to the blocked party.
      const foreignBlock = existing?.status === "BLOCKED" && existing.blockedById !== me.id;
      if (!foreignBlock) {
        const [a, b] = normalizePair(me.id, friendId);
        await prisma.friendship.upsert({
          where: { userAId_userBId: { userAId: a, userBId: b } },
          create: { userAId: a, userBId: b, status: "BLOCKED", blockedById: me.id },
          update: { status: "BLOCKED", blockedById: me.id },
        });
      }
    }
  }
  revalidatePath("/friends");
  redirect("/friends");
}

export async function removeFriendForm(formData: FormData) {
  const me = await requireUser();
  const friendId = String(formData.get("friendId") ?? "");
  const friendship = await findFriendship(me.id, friendId);
  // N4: a BLOCKED row belongs to whoever created the block. The blocked
  // party must not be able to delete it (that would silently unblock
  // themselves); only the blocker can remove it (via unblock).
  const foreignBlock = friendship?.status === "BLOCKED" && friendship.blockedById !== me.id;
  if (friendship && !foreignBlock) await prisma.friendship.delete({ where: { id: friendship.id } });
  revalidatePath("/friends");
  redirect("/friends");
}

// --- Groups ----------------------------------------------------------------

export async function createGroupForm(formData: FormData) {
  const me = await requireUser();
  if (await checkActionThrottle("group_create", me.email)) {
    throw new Error("you are creating groups too quickly — please wait a while");
  }
  const name = requireString(formData.get("name"), MAX_GROUP_NAME_LEN, "group name");
  const typeRaw = String(formData.get("type") ?? "other");
  const type = ["apartment", "house", "trip", "couple", "other"].includes(typeRaw) ? typeRaw : "other";
  const baseCurrency = parseCurrency(formData.get("baseCurrency"));
  const inviteEmails = String(formData.get("inviteEmails") ?? "")
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter((e) => isValidEmail(e) && e !== normalizeEmail(me.email));
  // Cap invitees per request (F3): an uncapped list lets one request mint
  // thousands of placeholder users + friendships (DB bloat, bulk probing).
  if (inviteEmails.length > MAX_GROUP_INVITEES) {
    throw new Error(`at most ${MAX_GROUP_INVITEES} people can be invited at once`);
  }
  const invitees: { user: Awaited<ReturnType<typeof resolveUserByEmail>>["user"]; suppressed: boolean }[] = [];
  for (const email of inviteEmails) {
    const u = (await resolveUserByEmail(email)).user;
    // Someone who blocked me (F1): no membership, no friendship. R11:
    // they still get a (suppressed) invitation row, so the group looks
    // exactly as if they were simply invited — the block stays hidden.
    invitees.push({ user: u, suppressed: await blockedBy(me.id, u.id) });
  }
  // N2: invitees start as INVITED — membership (and friendship) begins
  // only when they accept. Until then they see an invitation, accrue no
  // splits, and the group does not appear in their group list.
  const group = await prisma.group.create({
    data: {
      name, type, baseCurrency,
      members: {
        create: [
          { userId: me.id, status: "MEMBER" },
          ...[...new Map(invitees.map((i) => [i.user.id, i])).values()].map((i) => ({ userId: i.user.id, status: "INVITED" as const, invitedById: me.id, inviteSuppressed: i.suppressed })),
        ],
      },
      activities: { create: { userId: me.id, type: "group_created", message: `Group "${name}" created`, data: {} } },
    },
  });
  await recordAction("group_create", me.email, clientIp(await headers()));
  revalidatePath("/groups");
  redirect(`/groups/${group.id}`);
}

export async function addGroupMemberForm(formData: FormData) {
  const me = await requireUser();
  if (await checkActionThrottle("group_member_add", me.email)) {
    throw new Error("you are adding members too quickly — please wait a while");
  }
  const groupId = String(formData.get("groupId") ?? "");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const membership = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: me.id, groupId } } });
  if (!membership || membership.status !== "MEMBER") throw new Error("you are not a member of this group");
  if (!isValidEmail(email) || email === normalizeEmail(me.email)) redirect(flashUrl(`/groups/${groupId}?tab=members`, "error", "member_email_invalid"));
  const { user } = await resolveUserByEmail(email);
  // R10: a previous DECLINE of this group is final — no re-invites.
  const prior = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: user.id, groupId } } });
  if (prior?.status === "DECLINED") {
    redirect(flashUrl(`/groups/${groupId}?tab=members`, "error", "member_previously_declined"));
  }
  if (await blockedBy(me.id, user.id)) {
    // They blocked me. R11: previously the invite silently vanished and
    // the members list showed nothing — which told the inviter they
    // were blocked. Now a suppressed invitation is recorded: it looks
    // exactly like a pending invite to the inviter and the group, but
    // it is never surfaced to the invitee anywhere.
    await prisma.groupMember.upsert({
      where: { userId_groupId: { userId: user.id, groupId } },
      create: { userId: user.id, groupId, status: "INVITED", invitedById: me.id, inviteSuppressed: true },
      update: {},
    });
    await prisma.activity.create({ data: { groupId, userId: me.id, type: "member_invited", subjectId: user.id, message: "A new member was invited to the group", data: {} } });
    redirect(flashUrl(`/groups/${groupId}?tab=members`, "notice", "member_added"));
  }
  // N2: an invitation, not instant membership. The friendship is created
  // only when the invitee accepts (acceptGroupInviteForm).
  await prisma.groupMember.upsert({
    where: { userId_groupId: { userId: user.id, groupId } },
    create: { userId: user.id, groupId, status: "INVITED", invitedById: me.id },
    update: {},
  });
  // R1: the activity stores the invitee's ID, never the typed address —
  // the feed renders the person from their current row at read time.
  await prisma.activity.create({ data: { groupId, userId: me.id, type: "member_invited", subjectId: user.id, message: "A new member was invited to the group", data: {} } });
  await recordAction("group_member_add", me.email, clientIp(await headers()));
  revalidatePath(`/groups/${groupId}`);
  // Non-revealing response (F3): don't confirm the real name behind an
  // arbitrary email to the person adding it. (Co-members see names in the
  // members list by design — that's different from an email->name oracle.)
  redirect(flashUrl(`/groups/${groupId}?tab=members`, "notice", "member_added"));
}

/** Accept a group invitation (N2): membership starts now, and the
 *  friendship with the inviter becomes ACCEPTED (co-membership model) —
 *  never before acceptance, and never across a block. */
export async function acceptGroupInviteForm(formData: FormData) {
  const me = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const membership = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: me.id, groupId } } });
  if (!membership || membership.status !== "INVITED" || membership.inviteSuppressed) throw new Error("no pending invitation for this group");
  await prisma.groupMember.update({
    where: { userId_groupId: { userId: me.id, groupId } },
    data: { status: "MEMBER", joinedAt: new Date() },
  });
  if (membership.invitedById && membership.invitedById !== me.id) {
    await befriend(membership.invitedById, me.id);
  }
  await prisma.activity.create({ data: { groupId, userId: me.id, type: "member_joined", message: "A member joined the group", data: {} } });
  revalidatePath("/dashboard");
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

/** Decline a group invitation (N2 + R10): the row is kept as DECLINED —
 *  no membership, no friendship, no debt — and the group cannot be
 *  re-offered to me by re-inviting (addGroupMemberForm refuses). Before
 *  R10 the row was deleted, so an inviter could re-invite endlessly. */
export async function declineGroupInviteForm(formData: FormData) {
  const me = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  await prisma.groupMember.updateMany({
    where: { userId: me.id, groupId, status: "INVITED", inviteSuppressed: false },
    data: { status: "DECLINED" },
  });
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Leave a group (F1): removes my membership. My past expenses stay as
 *  history (balances with remaining members are preserved). */
export async function leaveGroupForm(formData: FormData) {
  const me = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const membership = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: me.id, groupId } } });
  if (membership) {
    await prisma.groupMember.delete({ where: { userId_groupId: { userId: me.id, groupId } } });
    await prisma.activity.create({ data: { groupId, userId: me.id, type: "member_left", message: "A member left the group", data: {} } });
  }
  revalidatePath("/groups");
  redirect("/groups");
}

// --- Expenses --------------------------------------------------------------

interface CreateExpenseInput {
  groupId: string | null;
  description: string;
  amountInCents: number;
  currency: string;
  paidById: string;
  category: string;
  date: Date;
  notes: string | null;
  participantIds: string[]; // split participants (may exclude the payer)
}

async function createExpense(meId: string, input: CreateExpenseInput) {
  input.description = requireString(input.description, MAX_DESCRIPTION_LEN, "description");
  input.category = capString(input.category || "General", MAX_CATEGORY_LEN, "category") || "General";
  input.currency = parseCurrency(input.currency);
  if (input.notes) input.notes = capString(input.notes, MAX_NOTES_LEN, "notes");
  if (!Number.isInteger(input.amountInCents) || input.amountInCents <= 0) throw new Error("amount must be positive integer cents");
  if (input.participantIds.length === 0) throw new Error("at least one participant is required");
  let allowedIds: Set<string>;
  if (input.groupId) {
    // N2: only ACCEPTED members can be charged — an invited (not yet
    // accepted) member accrues no splits and no debt.
    const members = await prisma.groupMember.findMany({ where: { groupId: input.groupId, status: "MEMBER" } });
    if (!members.some((m) => m.userId === meId)) throw new Error("you are not a member of this group");
    allowedIds = new Set(members.map((m) => m.userId));
  } else {
    // Friend expense: participants must be me or my ACCEPTED friends (F1) —
    // a pending request grants no right to put someone in debt.
    const friendships = await prisma.friendship.findMany({ where: { status: "ACCEPTED", OR: [{ userAId: meId }, { userBId: meId }] } });
    allowedIds = new Set([meId, ...friendships.map((f) => (f.userAId === meId ? f.userBId : f.userAId))]);
  }
  for (const id of [...input.participantIds, input.paidById]) {
    if (!allowedIds.has(id)) throw new Error("participant is not in scope for this expense");
  }
  if (!input.groupId) {
    // R11: in friend mode, two of MY friends who are not friends with
    // EACH OTHER must not end up in a shared ledger — the expense would
    // show each of them the other's name and balances. Multi-party
    // splits among non-friends belong in a group, where membership is
    // the consent.
    const others = [...new Set([...input.participantIds, input.paidById])].filter((id) => id !== meId);
    for (let i = 0; i < others.length; i++) {
      for (let j = i + 1; j < others.length; j++) {
        if (!(await areFriends(others[i], others[j]))) {
          throw new Error("in a friend expense, everyone besides you must also be friends with each other — use a group instead");
        }
      }
    }
  }
  const splits = computeSplit(input.amountInCents, "equal", [...new Set(input.participantIds)]);
  const expense = await prisma.expense.create({
    data: {
      groupId: input.groupId, description: input.description.trim(), amountInCents: input.amountInCents,
      currency: input.currency, paidById: input.paidById, category: input.category,
      date: input.date, notes: input.notes,
      splits: { create: splits },
    },
    include: { splits: true },
  });
  await prisma.activity.create({
    data: { groupId: input.groupId, userId: meId, type: "expense_added", subjectId: expense.paidById, message: `Expense "${expense.description}" added`, data: { description: expense.description } },
  });
  return expense;
}

/** Global "Add expense" form (/expenses/new): group OR friends context.
 *  The form submits explicit participantIds (the split participants); the
 *  "include payer in the split" toggle is just one of those checkboxes. */
export async function addExpenseForm(formData: FormData) {
  const me = await requireUser();
  const context = String(formData.get("context") ?? "friends");
  const groupId = context === "group" ? String(formData.get("groupId") ?? "") || null : null;
  const paidById = String(formData.get("paidById") ?? me.id);
  const participantIds = [...new Set(formData.getAll("participantIds").map(String))];
  if (participantIds.length === 0) {
    redirect(flashUrl("/expenses/new", "error", "pick_participant"));
  }
  const expense = await createExpense(me.id, {
    groupId,
    description: String(formData.get("description") ?? ""),
    amountInCents: parseAmountToCents(formData.get("amount")),
    currency: parseCurrency(formData.get("currency")),
    paidById,
    category: String(formData.get("category") ?? "General") || "General",
    date: parseDate(formData.get("date")),
    notes: String(formData.get("notes") ?? "").trim() || null,
    participantIds,
  });
  revalidatePath("/dashboard");
  if (expense.groupId) redirect(`/groups/${expense.groupId}`);
  redirect("/dashboard");
}

/** Group page "Add expense" form — keeps equal/exact/percentage modes. */
export async function addGroupExpenseForm(formData: FormData) {
  const me = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const members = await prisma.groupMember.findMany({ where: { groupId, status: "MEMBER" } });
  if (!members.some((m) => m.userId === me.id)) throw new Error("you are not a member of this group");
  const memberIds = new Set(members.map((m) => m.userId));
  const participantIds = formData.getAll("participantIds").map(String).filter((id) => memberIds.has(id));
  const paidById = String(formData.get("paidById") ?? me.id);
  if (!memberIds.has(paidById)) throw new Error("payer must be a group member");
  const mode = (String(formData.get("mode") ?? "equal") as "equal" | "exact" | "percentage");
  const amountInCents = parseAmountToCents(formData.get("amount"));
  const payload = mode === "exact"
    ? participantIds.map((userId) => ({ userId, amountOwedInCents: Math.round(parseFloat(String(formData.get(`exact_${userId}`) ?? "0")) * 100) }))
    : mode === "percentage"
      ? participantIds.map((userId) => ({ userId, percentage: parseInt(String(formData.get(`pct_${userId}`) ?? "0"), 10) }))
      : participantIds;
  const splits = computeSplit(amountInCents, mode, payload);
  const expense = await prisma.expense.create({
    data: {
      groupId, description: requireString(formData.get("description"), MAX_DESCRIPTION_LEN, "description"), amountInCents,
      currency: parseCurrency(formData.get("currency")),
      paidById, category: capString(formData.get("category") || "General", MAX_CATEGORY_LEN, "category") || "General",
      splits: { create: splits },
    },
    include: { splits: true },
  });
  await prisma.activity.create({ data: { groupId, userId: me.id, type: "expense_added", message: `Expense "${expense.description}" added` } });
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

/** Delete (void) an expense (F1). Allowed for the payer OR any participant
 *  in its splits — an affected party can always remove a debt recorded
 *  against them. Splits and items cascade; a receipt row is removed and the
 *  payer's storage counter is credited back. */
/** Void an expense (N5, re-audit). The old hard delete let any
 *  participant erase a debt — and the payer's receivable — without a
 *  trace. Now the expense is VOIDED: it stays visible as history with
 *  its splits, stops counting toward every balance, the receipt FILE
 *  is removed from storage (N10: previously only the row went), and an
 *  activity entry is always written — group or friend expense alike —
 *  so the payer can see what happened. */
export async function deleteExpenseForm(formData: FormData) {
  const me = await requireUser();
  const expenseId = String(formData.get("expenseId") ?? "");
  const expense = await getMyExpense(me.id, expenseId); // payer or participant only
  if (!expense) throw new Error("expense not found");
  if (expense.voidedAt) throw new Error("expense already voided");
  if (expense.receipt) {
    // Remove the stored file itself, then the row, then credit the quota.
    await storage.remove(expense.receipt.filePath).catch(() => {});
    await prisma.receipt.delete({ where: { id: expense.receipt.id } }).catch(() => {});
    await prisma.user.update({
      where: { id: expense.paidById },
      data: { receiptStorageUsedBytes: { decrement: expense.receipt.fileSizeBytes } },
    }).catch(() => {});
    await prisma.user.updateMany({
      where: { id: expense.paidById, receiptStorageUsedBytes: { lt: 0 } },
      data: { receiptStorageUsedBytes: BigInt(0) },
    }).catch(() => {});
  }
  await prisma.expense.update({
    where: { id: expenseId },
    data: { voidedAt: new Date(), voidedById: me.id, receiptId: null },
  });
  await prisma.activity.create({
    data: { groupId: expense.groupId, userId: me.id, type: "expense_voided", subjectId: expense.paidById, message: `Expense "${expense.description}" voided`, data: { description: expense.description } },
  });
  revalidatePath("/dashboard");
  redirect(expense.groupId ? `/groups/${expense.groupId}` : "/dashboard");
}

/** Restore a voided expense (R7): the PAYER can undo a void — the
 *  expense counts again. The receipt file does not come back (voiding
 *  removed it from storage); the payer can re-upload it. A restore is
 *  written to activity like the void was. */
export async function restoreExpenseForm(formData: FormData) {
  const me = await requireUser();
  const expenseId = String(formData.get("expenseId") ?? "");
  const expense = await getMyExpense(me.id, expenseId);
  if (!expense) throw new Error("expense not found");
  if (!expense.voidedAt) throw new Error("expense is not voided");
  if (expense.paidById !== me.id) throw new Error("only the payer can restore a voided expense");
  await prisma.expense.update({
    where: { id: expenseId },
    data: { voidedAt: null, voidedById: null },
  });
  await prisma.activity.create({
    data: { groupId: expense.groupId, userId: me.id, type: "expense_restored", subjectId: expense.paidById, message: `Expense "${expense.description}" restored`, data: { description: expense.description } },
  });
  revalidatePath("/dashboard");
  redirect(expense.groupId ? `/groups/${expense.groupId}` : `/receipts/${expenseId}`);
}

export async function addItemForm(formData: FormData) {
  const me = await requireUser();
  const expenseId = String(formData.get("expenseId") ?? "");
  const expense = await getMyExpense(me.id, expenseId);
  if (!expense) throw new Error("expense not found");
  if (expense.voidedAt) throw new Error("expense is voided");
  const amountInCents = Math.round(parseFloat(String(formData.get("amount") ?? "")) * 100);
  if (!Number.isInteger(amountInCents) || amountInCents < 0) throw new Error("item amount must be integer cents >= 0");
  const participantIds = new Set([expense.paidById, ...expense.splits.map((s) => s.userId)]);
  // Itemization v2: an item may be shared by a SUBSET of participants
  // (checkboxes named assignedToUserIds). None checked = everyone shares
  // it. The legacy single-select (assignedToUserId) still works.
  const multi = formData.getAll("assignedToUserIds").map(String).filter((uid) => participantIds.has(uid));
  const legacy = String(formData.get("assignedToUserId") ?? "");
  const assignedToUserIds = [...new Set(multi.length > 0 ? multi : legacy && participantIds.has(legacy) ? [legacy] : [])];
  await prisma.expenseItem.create({
    data: {
      expenseId,
      description: requireString(formData.get("description"), MAX_DESCRIPTION_LEN, "item description"),
      amountInCents,
      assignedToUserIds,
      assignedToUserId: assignedToUserIds.length === 1 ? assignedToUserIds[0] : null,
    },
  });
  revalidatePath(`/receipts/${expenseId}`);
  redirect(`/receipts/${expenseId}`);
}

export async function deleteItemForm(formData: FormData) {
  const me = await requireUser();
  const expenseId = String(formData.get("expenseId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const expense = await getMyExpense(me.id, expenseId);
  if (!expense) throw new Error("expense not found");
  if (expense.voidedAt) throw new Error("expense is voided");
  await prisma.expenseItem.deleteMany({ where: { id: itemId, expenseId } });
  revalidatePath(`/receipts/${expenseId}`);
  redirect(`/receipts/${expenseId}`);
}

/**
 * Itemization v2: make the receipt items DRIVE the expense's splits.
 * Payer only (the receipt is the payer's evidence, R5). Each item splits
 * among its assignees (everyone when unassigned); the un-itemized rest
 * (tax, tip, extras) splits equally among all participants. Replaces the
 * split rows in one transaction and records the change in activity.
 */
export async function applyItemizationForm(formData: FormData) {
  const me = await requireUser();
  const expenseId = String(formData.get("expenseId") ?? "");
  const expense = await getMyExpense(me.id, expenseId);
  if (!expense) throw new Error("expense not found");
  if (expense.voidedAt) throw new Error("expense is voided");
  if (expense.paidById !== me.id) throw new Error("only the payer can apply itemization");
  if (expense.items.length === 0) throw new Error("no items to apply");
  const participantIds = [expense.paidById, ...expense.splits.map((s) => s.userId).filter((uid) => uid !== expense.paidById)];
  const items = expense.items.map((it) => ({
    amountInCents: it.amountInCents,
    assignedToUserIds: it.assignedToUserIds.length > 0 ? it.assignedToUserIds : it.assignedToUserId ? [it.assignedToUserId] : [],
  }));
  let shares;
  try {
    shares = itemizedSplits(expense.amountInCents, items, participantIds);
  } catch {
    redirect(flashUrl(`/receipts/${expenseId}`, "error", "items_exceed_total"));
  }
  await prisma.$transaction([
    prisma.expenseSplit.deleteMany({ where: { expenseId } }),
    prisma.expenseSplit.createMany({ data: shares!.map((s) => ({ expenseId, userId: s.userId, amountOwedInCents: s.amountOwedInCents })) }),
  ]);
  await prisma.activity.create({
    data: { groupId: expense.groupId, userId: me.id, type: "expense_itemized", subjectId: expense.paidById, message: `Itemized split applied to "${expense.description}"`, data: { description: expense.description } },
  });
  revalidatePath("/dashboard");
  redirect(flashUrl(`/receipts/${expenseId}`, "notice", "itemization_applied"));
}

/** Form wrapper around uploadReceipt for the receipt page's file input
 *  (server actions can't take a Buffer from the browser; FormData can). */
export async function uploadReceiptForm(formData: FormData) {
  const expenseId = String(formData.get("expenseId") ?? "");
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) {
    redirect(flashUrl(`/receipts/${expenseId}`, "error", "receipt_missing"));
  }
  const data = Buffer.from(await (file as File).arrayBuffer());
  await uploadReceipt(expenseId, (file as File).name, data, (file as File).type);
  revalidatePath(`/receipts/${expenseId}`);
  redirect(flashUrl(`/receipts/${expenseId}`, "notice", "receipt_uploaded"));
}

/** Upload a receipt at full resolution via the StorageProvider; enforces the
 *  per-user quota. Identity = session user; expense must be one of mine.
 *  Type is verified against the file's magic bytes (F7), storage is private,
 *  quota updates are atomic increments, and replacing a receipt deletes the
 *  old file and credits its bytes back. */
export async function uploadReceipt(expenseId: string, fileName: string, data: Buffer, mimeType?: string) {
  const me = await requireUser();
  const expense = await getMyExpense(me.id, expenseId);
  if (!expense) throw new Error("expense not found");
  // R5: the receipt is the PAYER's evidence and the storage quota is the
  // payer's. Previously any participant could replace it — deleting the
  // payer's file while the freed bytes were credited to the REPLACER's
  // counter (which could go negative and mint quota). Payer only, and
  // never on a voided expense.
  if (expense.voidedAt) throw new Error("expense is voided");
  if (expense.paidById !== me.id) throw new Error("only the payer can manage the receipt");
  assertValidUpload(fileName, data, mimeType);
  assertCanUpload(me.receiptStorageUsedBytes, BigInt(data.byteLength), me.receiptStorageQuotaBytes);
  const saved = await storage.save(fileName, data);
  const receipt = await prisma.receipt.create({ data: { filePath: saved.filePath, fileSizeBytes: saved.fileSizeBytes } });
  const old = expense.receipt;
  await prisma.expense.update({ where: { id: expenseId }, data: { receiptId: receipt.id } });
  await prisma.user.update({
    where: { id: me.id },
    data: { receiptStorageUsedBytes: { increment: saved.fileSizeBytes } },
  });
  if (old) {
    await storage.remove(old.filePath).catch(() => {});
    await prisma.receipt.delete({ where: { id: old.id } }).catch(() => {});
    await prisma.user.update({
      where: { id: me.id },
      data: { receiptStorageUsedBytes: { decrement: old.fileSizeBytes } },
    }).catch(() => {});
    // Clamp at zero: the counter must never go negative (a negative
    // balance is spendable quota).
    await prisma.user.updateMany({
      where: { id: me.id, receiptStorageUsedBytes: { lt: 0 } },
      data: { receiptStorageUsedBytes: BigInt(0) },
    }).catch(() => {});
  }
  await ocrReceipt(saved.filePath); // stub: returns [] for manual itemization
  return receipt;
}

// --- Settlements -----------------------------------------------------------

/** R6: cap unconfirmed settlements per pair — without it, one person
 *  can flood the other with pending records (and the group feed with
 *  activity lines) that the victim must wade through. */
const MAX_PENDING_SETTLEMENTS_PER_PAIR = 10;
async function assertPendingSettlementCapacity(recorderId: string, a: string, b: string) {
  const n = await prisma.settlement.count({
    where: {
      recordedById: recorderId, status: "PENDING",
      OR: [{ fromUserId: a, toUserId: b }, { fromUserId: b, toUserId: a }],
    },
  });
  if (n >= MAX_PENDING_SETTLEMENTS_PER_PAIR) {
    throw new Error("too many unconfirmed settlements with this person — ask them to confirm or reject the existing ones first");
  }
}

/** Record a settlement payment. Session user must be one of the two parties. */
export async function recordSettlementForm(formData: FormData) {
  const me = await requireUser();
  const fromUserId = String(formData.get("fromUserId") ?? "");
  const toUserId = String(formData.get("toUserId") ?? "");
  const groupId = String(formData.get("groupId") ?? "") || null;
  const amountInCents = parseAmountToCents(formData.get("amount"));
  const back = safeBackPath(formData.get("back"));
  if (fromUserId === toUserId) throw new Error("cannot settle with yourself");
  if (fromUserId !== me.id && toUserId !== me.id) throw new Error("you are not a party to this settlement");
  if (groupId) {
    const members = await prisma.groupMember.findMany({ where: { groupId, status: "MEMBER" } });
    const ids = new Set(members.map((m) => m.userId));
    if (!ids.has(me.id) || !ids.has(fromUserId) || !ids.has(toUserId)) throw new Error("both parties must be group members");
  } else {
    // Friend-level settlement: the other party must be my friend or share a
    // group / expense history with me — strangers by guessed id are rejected.
    const otherId = fromUserId === me.id ? toUserId : fromUserId;
    const ok = (await areFriends(me.id, otherId)) ||
      !!(await prisma.groupMember.findFirst({ where: { userId: me.id, status: "MEMBER", group: { members: { some: { userId: otherId, status: "MEMBER" } } } } })) ||
      !!(await prisma.expense.findFirst({
        where: { OR: [
          { paidById: me.id, splits: { some: { userId: otherId } } },
          { paidById: otherId, splits: { some: { userId: me.id } } },
        ] },
      }));
    if (!ok) throw new Error("you can only settle up with someone you share expenses with");
  }
  await assertPendingSettlementCapacity(me.id, fromUserId, toUserId);
  // N3: a settlement starts PENDING and moves no balances until the OTHER
  // party confirms it — recording "you paid me" can no longer rewrite
  // someone else's ledger unilaterally.
  const settlement = await prisma.settlement.create({
    data: { fromUserId, toUserId, amountInCents, groupId, currency: parseCurrency(formData.get("currency")), status: "PENDING", recordedById: me.id },
  });
  await prisma.activity.create({
    data: { groupId, userId: me.id, type: "settlement", subjectId: toUserId, message: "A settlement was recorded (pending confirmation)", data: { fromUserId, verb: "recorded" } },
  });
  revalidatePath("/dashboard");
  redirect(back);
}

/** Load a settlement I am a party to, or throw. */
async function mySettlement(meId: string, settlementId: string) {
  const s = await prisma.settlement.findUnique({ where: { id: settlementId } });
  if (!s || (s.fromUserId !== meId && s.toUserId !== meId)) throw new Error("not your settlement");
  return s;
}

async function settlementActivity(s: { id: string; groupId: string | null; fromUserId: string; toUserId: string }, meId: string, verb: string) {
  // R1: ids + verb only — the feed renders the names at read time.
  await prisma.activity.create({
    data: { groupId: s.groupId, userId: meId, type: "settlement", subjectId: s.toUserId, message: "A settlement was updated", data: { fromUserId: s.fromUserId, verb } },
  });
}

/** Confirm a settlement the OTHER party recorded (N3). Only the
 *  counterparty can confirm — never the person who entered it. */
export async function confirmSettlementForm(formData: FormData) {
  const me = await requireUser();
  const back = safeBackPath(formData.get("back"));
  const s = await mySettlement(me.id, String(formData.get("settlementId") ?? ""));
  if (s.status !== "PENDING") throw new Error("settlement is not pending");
  if (s.recordedById === me.id) throw new Error("you cannot confirm your own settlement entry");
  await prisma.settlement.update({ where: { id: s.id }, data: { status: "CONFIRMED" } });
  await settlementActivity(s, me.id, "confirmed");
  revalidatePath("/dashboard");
  redirect(flashUrl(back, "notice", "settlement_confirmed"));
}

/** Reject a pending settlement recorded by the other party (N3). */
export async function rejectSettlementForm(formData: FormData) {
  const me = await requireUser();
  const back = safeBackPath(formData.get("back"));
  const s = await mySettlement(me.id, String(formData.get("settlementId") ?? ""));
  if (s.status !== "PENDING") throw new Error("settlement is not pending");
  if (s.recordedById === me.id) throw new Error("cancel your own entry instead of rejecting it");
  await prisma.settlement.update({ where: { id: s.id }, data: { status: "VOIDED" } });
  await settlementActivity(s, me.id, "rejected");
  revalidatePath("/dashboard");
  redirect(flashUrl(back, "notice", "settlement_voided"));
}

/** Void a settlement. A PENDING entry is cancelled by its recorder
 *  (N3). A CONFIRMED settlement is a fact both parties agreed to, so
 *  voiding it needs both parties too (R6): the first party's void
 *  becomes a REQUEST — the settlement keeps counting — and it only
 *  stops counting when the other party agrees (confirmVoidSettlement­
 *  Form). The row always stays as the audit trail. */
export async function voidSettlementForm(formData: FormData) {
  const me = await requireUser();
  const back = safeBackPath(formData.get("back"));
  const s = await mySettlement(me.id, String(formData.get("settlementId") ?? ""));
  if (s.status === "VOIDED") throw new Error("settlement already voided");
  if (s.status === "VOID_REQUESTED") throw new Error("a void is already awaiting the other party");
  if (s.status === "PENDING") {
    if (s.recordedById !== me.id) throw new Error("only the recorder can cancel a pending settlement — reject it instead");
    await prisma.settlement.update({ where: { id: s.id }, data: { status: "VOIDED" } });
    await settlementActivity(s, me.id, "voided");
    revalidatePath("/dashboard");
    redirect(flashUrl(back, "notice", "settlement_voided"));
  }
  // CONFIRMED: record the request; balances do not change yet.
  await prisma.settlement.update({ where: { id: s.id }, data: { status: "VOID_REQUESTED", voidRequestedById: me.id } });
  await settlementActivity(s, me.id, "void_requested");
  revalidatePath("/dashboard");
  redirect(flashUrl(back, "notice", "settlement_void_requested"));
}

/** Agree to void a CONFIRMED settlement the other party asked to void
 *  (R6). Only the party who did NOT request it can agree. */
export async function confirmVoidSettlementForm(formData: FormData) {
  const me = await requireUser();
  const back = safeBackPath(formData.get("back"));
  const s = await mySettlement(me.id, String(formData.get("settlementId") ?? ""));
  if (s.status !== "VOID_REQUESTED") throw new Error("no void is pending for this settlement");
  if (s.voidRequestedById === me.id) throw new Error("you cannot agree to your own void request");
  await prisma.settlement.update({ where: { id: s.id }, data: { status: "VOIDED", voidRequestedById: null } });
  await settlementActivity(s, me.id, "void_confirmed");
  revalidatePath("/dashboard");
  redirect(flashUrl(back, "notice", "settlement_voided"));
}

/** Decline a void request (or withdraw your own): the settlement goes
 *  back to CONFIRMED and keeps counting (R6). */
export async function rejectVoidSettlementForm(formData: FormData) {
  const me = await requireUser();
  const back = safeBackPath(formData.get("back"));
  const s = await mySettlement(me.id, String(formData.get("settlementId") ?? ""));
  if (s.status !== "VOID_REQUESTED") throw new Error("no void is pending for this settlement");
  await prisma.settlement.update({ where: { id: s.id }, data: { status: "CONFIRMED", voidRequestedById: null } });
  await settlementActivity(s, me.id, "void_rejected");
  revalidatePath("/dashboard");
  redirect(flashUrl(back, "notice", "settlement_void_declined"));
}

/** Friend-detail settle-up: direction is derived from the current net. */
export async function settleFriendForm(formData: FormData) {
  const me = await requireUser();
  const friendId = String(formData.get("friendId") ?? "");
  if (!(await areFriends(me.id, friendId))) throw new Error("not your friend");
  const expenses = await prisma.expense.findMany({
    where: { OR: [
      { paidById: me.id, splits: { some: { userId: friendId } } },
      { paidById: friendId, splits: { some: { userId: me.id } } },
    ] },
    include: { splits: true },
  });
  const settlements = await prisma.settlement.findMany({
    where: { OR: [{ fromUserId: me.id, toUserId: friendId }, { fromUserId: friendId, toUserId: me.id }] },
  });
  const net = netBetween(me.id, friendId, expenses, settlements);
  const provided = formData.get("amount");
  const amountInCents = provided ? parseAmountToCents(provided) : Math.abs(net);
  if (amountInCents <= 0) redirect(flashUrl(`/friends/${friendId}`, "notice", "already_settled"));
  const fromUserId = net > 0 ? friendId : me.id;
  const toUserId = net > 0 ? me.id : friendId;
  await assertPendingSettlementCapacity(me.id, fromUserId, toUserId);
  // N3: even the one-click settle-up starts PENDING — it counts only
  // once the other party confirms it actually happened.
  await prisma.settlement.create({ data: { fromUserId, toUserId, amountInCents, groupId: null, status: "PENDING", recordedById: me.id } });
  await prisma.activity.create({ data: { groupId: null, userId: me.id, type: "settlement", subjectId: toUserId, message: "Settlement recorded with a friend (pending confirmation)", data: { fromUserId, verb: "recorded" } } });
  revalidatePath("/dashboard");
  redirect(flashUrl(`/friends/${friendId}`, "notice", "settlement_recorded"));
}

// --- Pro / settings / export ------------------------------------------------

export async function grantTripPassForm(formData: FormData) {
  const me = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  if (!canGrantTripPass(me)) throw new Error("only Pro users can grant a Trip Pass");
  const membership = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: me.id, groupId } } });
  if (!membership || membership.status !== "MEMBER") throw new Error("you are not a member of this group");
  await prisma.tripPass.create({ data: { grantedByUserId: me.id, groupId, expiresAt: tripPassExpiry(new Date()) } });
  await prisma.activity.create({ data: { groupId, userId: me.id, type: "trip_pass_granted", message: "Trip Pass granted (30 days of Pro for this group)", data: {} } });
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?tab=activity`);
}

export async function setDefaultSplitForm(formData: FormData) {
  const me = await requireUser();
  const percentage = parseInt(String(formData.get("percentage") ?? ""), 10);
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new Error("percentage must be an integer 0-100");
  const groupId = String(formData.get("groupId") ?? "") || null;
  const otherUserId = String(formData.get("otherUserId") ?? "") || null;
  if (groupId) {
    const m = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: me.id, groupId } } });
    if (!m || m.status !== "MEMBER") throw new Error("not your group");
  }
  if (otherUserId && !(await areFriends(me.id, otherUserId))) throw new Error("not your friend");
  await prisma.defaultSplit.create({ data: { userId: me.id, percentage, groupId, otherUserId } });
  revalidatePath("/settings");
  redirect("/settings");
}

export async function updateProfileForm(formData: FormData) {
  const me = await requireUser();
  const name = requireString(formData.get("name"), MAX_NAME_LEN, "name");
  const defaultCurrency = parseCurrency(formData.get("defaultCurrency"));
  await prisma.user.update({ where: { id: me.id }, data: { name, defaultCurrency } });
  revalidatePath("/settings");
  redirect(flashUrl("/settings", "notice", "profile_updated"));
}

/** Full JSON export of the SESSION user's data. */
export async function exportData() {
  const me = await requireUser();
  const data = await prisma.user.findUniqueOrThrow({
    where: { id: me.id },
    include: {
      // R2: only groups I actually belong to — an INVITED (or declined)
      // membership must not export the group's ledger to someone who
      // never accepted.
      memberships: { where: { status: "MEMBER" }, include: { group: { include: { expenses: { include: { splits: true, items: true } } } } } },
      paidExpenses: { include: { splits: true } },
      splits: { include: { expense: true } },
      settlementsSent: true,
      settlementsReceived: true,
      defaultSplits: true,
    },
  });
  const { passwordHash: _omit, ...safe } = data;
  return JSON.parse(JSON.stringify(safe, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
