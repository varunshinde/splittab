"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
import { computeSplit } from "@/lib/splits";
import { computeBalances, computeSimplifiedDebts } from "@/lib/debt";
import { convertCurrency, STATIC_RATES } from "@/lib/currency";
import { assertCanUpload, canGrantTripPass, tripPassExpiry } from "@/lib/pro";
import { storage } from "@/lib/storage";
import { ocrReceipt } from "@/lib/ocr";

export async function selectUser(userId: string) {
  (await cookies()).set(SESSION_COOKIE, userId, { httpOnly: true, path: "/", sameSite: "lax" });
  revalidatePath("/");
}
export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  revalidatePath("/");
}

export async function createUser(name: string, email: string) {
  return prisma.user.create({ data: { name, email } });
}

export async function createGroup(name: string, baseCurrency: string, creatorId: string, memberIds: string[] = []) {
  const group = await prisma.group.create({
    data: {
      name, baseCurrency,
      members: { create: [...new Set([creatorId, ...memberIds])].map((userId) => ({ userId })) },
      activities: { create: { userId: creatorId, type: "group_created", message: `Group "${name}" created` } },
    },
  });
  revalidatePath("/groups");
  return group;
}

export async function addGroupMember(groupId: string, userId: string) {
  return prisma.groupMember.create({ data: { groupId, userId } });
}

export interface AddExpenseInput {
  groupId: string; description: string; amountInCents: number; currency?: string;
  paidById: string; category?: string; participantIds: string[];
  mode?: "equal" | "exact" | "percentage";
  exactShares?: { userId: string; amountOwedInCents: number }[];
  percentages?: { userId: string; percentage: number }[];
}
export async function addExpense(input: AddExpenseInput) {
  const payload = input.mode === "exact" ? input.exactShares! : input.mode === "percentage" ? input.percentages! : input.participantIds;
  const splits = computeSplit(input.amountInCents, input.mode ?? "equal", payload);
  const expense = await prisma.expense.create({
    data: {
      groupId: input.groupId, description: input.description, amountInCents: input.amountInCents,
      currency: input.currency ?? "USD", paidById: input.paidById, category: input.category ?? "General",
      splits: { create: splits },
    },
    include: { splits: true },
  });
  await prisma.activity.create({ data: { groupId: input.groupId, userId: input.paidById, type: "expense_added", message: `Expense "${input.description}" added` } });
  revalidatePath(`/groups/${input.groupId}`);
  return expense;
}

export async function addExpenseItem(expenseId: string, description: string, amountInCents: number, assignedToUserId?: string) {
  if (!Number.isInteger(amountInCents) || amountInCents < 0) throw new Error("item amount must be integer cents >= 0");
  return prisma.expenseItem.create({ data: { expenseId, description, amountInCents, assignedToUserId: assignedToUserId || null } });
}

/** Upload a receipt at full resolution via the StorageProvider; enforces the per-user quota. */
export async function uploadReceipt(userId: string, expenseId: string, fileName: string, data: Buffer) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assertCanUpload(user.receiptStorageUsedBytes, BigInt(data.byteLength), user.receiptStorageQuotaBytes);
  const saved = await storage.save(fileName, data);
  const receipt = await prisma.receipt.create({ data: { filePath: saved.filePath, fileSizeBytes: saved.fileSizeBytes } });
  await prisma.expense.update({ where: { id: expenseId }, data: { receiptId: receipt.id } });
  await prisma.user.update({ where: { id: userId }, data: { receiptStorageUsedBytes: user.receiptStorageUsedBytes + saved.fileSizeBytes } });
  await ocrReceipt(saved.filePath); // stub: returns [] for manual itemization
  return receipt;
}

/** CSV import stub — no live bank API. Parses "description,amountInCents,paidById" rows into expenses. */
export async function importTransactions(groupId: string, csv: string) {
  const rows = csv.trim().split("\n").slice(1).filter(Boolean);
  let created = 0;
  for (const row of rows) {
    const [description, amount, paidById] = row.split(",").map((s) => s.trim());
    const members = await prisma.groupMember.findMany({ where: { groupId } });
    await addExpense({ groupId, description, amountInCents: parseInt(amount, 10), paidById, participantIds: members.map((m) => m.userId) });
    created += 1;
  }
  return { created };
}

export async function settleUp(groupId: string) {
  const expenses = await prisma.expense.findMany({ where: { groupId }, include: { splits: true } });
  return computeSimplifiedDebts(computeBalances(expenses));
}

export async function exportData(userId: string) {
  const data = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { memberships: { include: { group: { include: { expenses: { include: { splits: true, items: true } } } } } }, paidExpenses: true, defaultSplits: true },
  });
  return JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export async function grantTripPass(grantedByUserId: string, groupId: string) {
  const grantor = await prisma.user.findUniqueOrThrow({ where: { id: grantedByUserId } });
  if (!canGrantTripPass(grantor)) throw new Error("only Pro users can grant a Trip Pass");
  const pass = await prisma.tripPass.create({ data: { grantedByUserId, groupId, expiresAt: tripPassExpiry(new Date()) } });
  await prisma.activity.create({ data: { groupId, userId: grantedByUserId, type: "trip_pass_granted", message: "Trip Pass granted (30 days of Pro for this group)" } });
  revalidatePath(`/groups/${groupId}`);
  return pass;
}

export async function setDefaultSplit(userId: string, percentage: number, groupId?: string, otherUserId?: string) {
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new Error("percentage must be an integer 0-100");
  return prisma.defaultSplit.create({ data: { userId, percentage, groupId: groupId || null, otherUserId: otherUserId || null } });
}

export async function convertCurrencyAction(amountInCents: number, from: string, to: string) {
  const rates = await prisma.currencyRate.findMany().catch(() => []);
  const table = rates.length ? Object.fromEntries(rates.map((r) => [`${r.fromCurrency}->${r.toCurrency}`, r.rateScaled])) : STATIC_RATES;
  return convertCurrency(amountInCents, from, to, table);
}

// Form-action wrappers (thin adapters so pages can use <form action={...}>)
export async function createGroupForm(formData: FormData) {
  const creatorId = String(formData.get("creatorId"));
  await createGroup(String(formData.get("name")), String(formData.get("baseCurrency") || "USD"), creatorId, formData.getAll("memberIds").map(String));
}
export async function addExpenseForm(formData: FormData) {
  const participantIds = formData.getAll("participantIds").map(String);
  const mode = (String(formData.get("mode") || "equal") as "equal" | "exact" | "percentage");
  const amountInCents = Math.round(parseFloat(String(formData.get("amount"))) * 100);
  const percentages = participantIds.map((userId) => ({ userId, percentage: parseInt(String(formData.get(`pct_${userId}`) || "0"), 10) }));
  const exactShares = participantIds.map((userId) => ({ userId, amountOwedInCents: Math.round(parseFloat(String(formData.get(`exact_${userId}`) || "0")) * 100) }));
  await addExpense({ groupId: String(formData.get("groupId")), description: String(formData.get("description")), amountInCents, paidById: String(formData.get("paidById")), category: String(formData.get("category") || "General"), currency: String(formData.get("currency") || "USD"), participantIds, mode, percentages, exactShares });
}
export async function addItemForm(formData: FormData) {
  await addExpenseItem(String(formData.get("expenseId")), String(formData.get("description")), Math.round(parseFloat(String(formData.get("amount"))) * 100), String(formData.get("assignedToUserId") || "") || undefined);
  revalidatePath(`/receipts/${String(formData.get("expenseId"))}`);
}
export async function grantTripPassForm(formData: FormData) {
  await grantTripPass(String(formData.get("grantedByUserId")), String(formData.get("groupId")));
}
export async function setDefaultSplitForm(formData: FormData) {
  await setDefaultSplit(String(formData.get("userId")), parseInt(String(formData.get("percentage")), 10), String(formData.get("groupId") || "") || undefined, String(formData.get("otherUserId") || "") || undefined);
  revalidatePath("/settings");
}
export async function selectUserForm(formData: FormData) { await selectUser(String(formData.get("userId"))); }
