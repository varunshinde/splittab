"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { computeSplit } from "@/lib/splits";
import { netBetween } from "@/lib/balances";
import { convertCurrency, STATIC_RATES } from "@/lib/currency";
import { assertCanUpload, canGrantTripPass, tripPassExpiry } from "@/lib/pro";
import { storage } from "@/lib/storage";
import { ocrReceipt } from "@/lib/ocr";
import { decideAddFriend, isValidEmail, normalizeEmail, normalizePair } from "@/lib/friends";
import { areFriends, findFriendship, getMyExpense, resolveUserByEmail } from "@/lib/data";
import {
  assertValidUpload, capString, parseAmountCents, parseCurrency, parseDate, requireString, safeBackPath,
  MAX_CATEGORY_LEN, MAX_DESCRIPTION_LEN, MAX_GROUP_NAME_LEN, MAX_NOTES_LEN, MAX_NAME_LEN,
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

async function befriend(userId: string, otherId: string) {
  const [a, b] = normalizePair(userId, otherId);
  await prisma.friendship.upsert({
    where: { userAId_userBId: { userAId: a, userBId: b } },
    create: { userAId: a, userBId: b, status: "ACCEPTED" },
    update: { status: "ACCEPTED" },
  });
}

// --- Friends ---------------------------------------------------------------

export async function addFriendForm(formData: FormData) {
  const me = await requireUser();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const existing = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  const already = existing ? await areFriends(me.id, existing.id) : false;
  const decision = decideAddFriend({
    myEmail: me.email,
    email,
    existingUser: existing ? { id: existing.id, email: existing.email, isPlaceholder: existing.isPlaceholder } : null,
    alreadyFriends: already,
  });
  if (decision.kind === "invalid-email") redirect(`/friends?error=${encodeURIComponent("Please enter a valid email address.")}`);
  if (decision.kind === "self") redirect(`/friends?error=${encodeURIComponent("That's your own email address.")}`);
  if (decision.kind === "already-friends") redirect(`/friends?notice=${encodeURIComponent("You are already friends with this person.")}`);
  const targetId = decision.kind === "existing-user" ? decision.userId : (await resolveUserByEmail(email)).user.id;
  await befriend(me.id, targetId);
  revalidatePath("/friends");
  redirect(`/friends?notice=${encodeURIComponent(decision.kind === "create-placeholder" ? "Friend added. They'll see the shared expenses when they sign up with this email." : "Friend added.")}`);
}

export async function removeFriendForm(formData: FormData) {
  const me = await requireUser();
  const friendId = String(formData.get("friendId") ?? "");
  const friendship = await findFriendship(me.id, friendId);
  if (friendship) await prisma.friendship.delete({ where: { id: friendship.id } });
  revalidatePath("/friends");
  redirect("/friends");
}

// --- Groups ----------------------------------------------------------------

export async function createGroupForm(formData: FormData) {
  const me = await requireUser();
  const name = requireString(formData.get("name"), MAX_GROUP_NAME_LEN, "group name");
  const typeRaw = String(formData.get("type") ?? "other");
  const type = ["apartment", "house", "trip", "couple", "other"].includes(typeRaw) ? typeRaw : "other";
  const baseCurrency = parseCurrency(formData.get("baseCurrency"));
  const inviteEmails = String(formData.get("inviteEmails") ?? "")
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter((e) => isValidEmail(e) && e !== normalizeEmail(me.email));
  const invitees = [];
  for (const email of inviteEmails) invitees.push((await resolveUserByEmail(email)).user);
  const group = await prisma.group.create({
    data: {
      name, type, baseCurrency,
      members: { create: [...new Set([me.id, ...invitees.map((u) => u.id)])].map((userId) => ({ userId })) },
      activities: { create: { userId: me.id, type: "group_created", message: `Group "${name}" created` } },
    },
  });
  for (const u of invitees) await befriend(me.id, u.id);
  revalidatePath("/groups");
  redirect(`/groups/${group.id}`);
}

export async function addGroupMemberForm(formData: FormData) {
  const me = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const membership = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: me.id, groupId } } });
  if (!membership) throw new Error("you are not a member of this group");
  if (!isValidEmail(email) || email === normalizeEmail(me.email)) redirect(`/groups/${groupId}?tab=members&error=${encodeURIComponent("Enter someone else's valid email.")}`);
  const { user } = await resolveUserByEmail(email);
  await prisma.groupMember.upsert({
    where: { userId_groupId: { userId: user.id, groupId } },
    create: { userId: user.id, groupId },
    update: {},
  });
  await befriend(me.id, user.id);
  await prisma.activity.create({ data: { groupId, userId: me.id, type: "member_added", message: `${user.name} added to the group` } });
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?tab=members&notice=${encodeURIComponent(`${user.name} added.`)}`);
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
    const members = await prisma.groupMember.findMany({ where: { groupId: input.groupId } });
    if (!members.some((m) => m.userId === meId)) throw new Error("you are not a member of this group");
    allowedIds = new Set(members.map((m) => m.userId));
  } else {
    // Friend expense: participants must be me or my friends.
    const friendships = await prisma.friendship.findMany({ where: { OR: [{ userAId: meId }, { userBId: meId }] } });
    allowedIds = new Set([meId, ...friendships.map((f) => (f.userAId === meId ? f.userBId : f.userAId))]);
  }
  for (const id of [...input.participantIds, input.paidById]) {
    if (!allowedIds.has(id)) throw new Error("participant is not in scope for this expense");
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
    data: { groupId: input.groupId, userId: meId, type: "expense_added", message: `Expense "${expense.description}" added` },
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
    redirect(`/expenses/new?error=${encodeURIComponent("Pick at least one person to split with.")}`);
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
  const members = await prisma.groupMember.findMany({ where: { groupId } });
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

export async function addItemForm(formData: FormData) {
  const me = await requireUser();
  const expenseId = String(formData.get("expenseId") ?? "");
  const expense = await getMyExpense(me.id, expenseId);
  if (!expense) throw new Error("expense not found");
  const amountInCents = Math.round(parseFloat(String(formData.get("amount") ?? "")) * 100);
  if (!Number.isInteger(amountInCents) || amountInCents < 0) throw new Error("item amount must be integer cents >= 0");
  const assignedRaw = String(formData.get("assignedToUserId") ?? "");
  const participantIds = new Set([expense.paidById, ...expense.splits.map((s) => s.userId)]);
  const assignedToUserId = assignedRaw && participantIds.has(assignedRaw) ? assignedRaw : null;
  await prisma.expenseItem.create({
    data: { expenseId, description: requireString(formData.get("description"), MAX_DESCRIPTION_LEN, "item description"), amountInCents, assignedToUserId },
  });
  revalidatePath(`/receipts/${expenseId}`);
  redirect(`/receipts/${expenseId}`);
}

/** Upload a receipt at full resolution via the StorageProvider; enforces the
 *  per-user quota. Identity = session user; expense must be one of mine.
 *  Only image/PDF mime types, hard 10MB per-file cap (see lib/validate). */
export async function uploadReceipt(expenseId: string, fileName: string, data: Buffer, mimeType?: string) {
  const me = await requireUser();
  const expense = await getMyExpense(me.id, expenseId);
  if (!expense) throw new Error("expense not found");
  assertValidUpload(fileName, data.byteLength, mimeType);
  assertCanUpload(me.receiptStorageUsedBytes, BigInt(data.byteLength), me.receiptStorageQuotaBytes);
  const saved = await storage.save(fileName, data);
  const receipt = await prisma.receipt.create({ data: { filePath: saved.filePath, fileSizeBytes: saved.fileSizeBytes } });
  await prisma.expense.update({ where: { id: expenseId }, data: { receiptId: receipt.id } });
  await prisma.user.update({ where: { id: me.id }, data: { receiptStorageUsedBytes: me.receiptStorageUsedBytes + saved.fileSizeBytes } });
  await ocrReceipt(saved.filePath); // stub: returns [] for manual itemization
  return receipt;
}

/** CSV import stub — no live bank API. Parses "description,amountInCents,paidById" rows. */
export async function importTransactions(groupId: string, csv: string) {
  const me = await requireUser();
  const members = await prisma.groupMember.findMany({ where: { groupId } });
  if (!members.some((m) => m.userId === me.id)) throw new Error("you are not a member of this group");
  const memberIds = new Set(members.map((m) => m.userId));
  const rows = csv.trim().split("\n").slice(1).filter(Boolean);
  let created = 0;
  for (const row of rows) {
    const [description, amount, paidById] = row.split(",").map((s) => s.trim());
    if (!memberIds.has(paidById)) continue;
    await createExpense(me.id, {
      groupId, description, amountInCents: parseInt(amount, 10), currency: "USD",
      paidById, category: "General", date: new Date(), notes: null,
      participantIds: members.map((m) => m.userId),
    });
    created += 1;
  }
  return { created };
}

// --- Settlements -----------------------------------------------------------

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
    const members = await prisma.groupMember.findMany({ where: { groupId } });
    const ids = new Set(members.map((m) => m.userId));
    if (!ids.has(me.id) || !ids.has(fromUserId) || !ids.has(toUserId)) throw new Error("both parties must be group members");
  } else {
    // Friend-level settlement: the other party must be my friend or share a
    // group / expense history with me — strangers by guessed id are rejected.
    const otherId = fromUserId === me.id ? toUserId : fromUserId;
    const ok = (await areFriends(me.id, otherId)) ||
      !!(await prisma.groupMember.findFirst({ where: { userId: me.id, group: { members: { some: { userId: otherId } } } } })) ||
      !!(await prisma.expense.findFirst({
        where: { OR: [
          { paidById: me.id, splits: { some: { userId: otherId } } },
          { paidById: otherId, splits: { some: { userId: me.id } } },
        ] },
      }));
    if (!ok) throw new Error("you can only settle up with someone you share expenses with");
  }
  await prisma.settlement.create({
    data: { fromUserId, toUserId, amountInCents, groupId, currency: parseCurrency(formData.get("currency")) },
  });
  const [fromUser, toUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: fromUserId } }),
    prisma.user.findUnique({ where: { id: toUserId } }),
  ]);
  await prisma.activity.create({
    data: { groupId, userId: me.id, type: "settlement", message: `${fromUser?.name ?? "Someone"} paid ${toUser?.name ?? "someone"} (settlement)` },
  });
  revalidatePath("/dashboard");
  redirect(back);
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
  if (amountInCents <= 0) redirect(`/friends/${friendId}?notice=${encodeURIComponent("You are already settled up.")}`);
  const fromUserId = net > 0 ? friendId : me.id;
  const toUserId = net > 0 ? me.id : friendId;
  await prisma.settlement.create({ data: { fromUserId, toUserId, amountInCents, groupId: null } });
  await prisma.activity.create({ data: { groupId: null, userId: me.id, type: "settlement", message: "Settlement recorded with a friend" } });
  revalidatePath("/dashboard");
  redirect(`/friends/${friendId}?notice=${encodeURIComponent("Settlement recorded.")}`);
}

// --- Pro / settings / export ------------------------------------------------

export async function grantTripPassForm(formData: FormData) {
  const me = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  if (!canGrantTripPass(me)) throw new Error("only Pro users can grant a Trip Pass");
  const membership = await prisma.groupMember.findUnique({ where: { userId_groupId: { userId: me.id, groupId } } });
  if (!membership) throw new Error("you are not a member of this group");
  await prisma.tripPass.create({ data: { grantedByUserId: me.id, groupId, expiresAt: tripPassExpiry(new Date()) } });
  await prisma.activity.create({ data: { groupId, userId: me.id, type: "trip_pass_granted", message: "Trip Pass granted (30 days of Pro for this group)" } });
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
    if (!m) throw new Error("not your group");
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
  redirect("/settings?notice=" + encodeURIComponent("Profile updated."));
}

/** Full JSON export of the SESSION user's data. */
export async function exportData() {
  const me = await requireUser();
  const data = await prisma.user.findUniqueOrThrow({
    where: { id: me.id },
    include: {
      memberships: { include: { group: { include: { expenses: { include: { splits: true, items: true } } } } } },
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

export async function convertCurrencyAction(amountInCents: number, from: string, to: string) {
  await requireUser();
  const rates = await prisma.currencyRate.findMany().catch(() => []);
  const table = rates.length ? Object.fromEntries(rates.map((r) => [`${r.fromCurrency}->${r.toCurrency}`, r.rateScaled])) : STATIC_RATES;
  return convertCurrency(amountInCents, from, to, table);
}
