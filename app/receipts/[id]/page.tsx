import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getMyExpense } from "@/lib/data";
import { formatMoney } from "@/lib/format";
import { flashText } from "@/lib/flash";
import { itemizedSplits } from "@/lib/splits";
import { addItemForm, applyItemizationForm, deleteExpenseForm, deleteItemForm, restoreExpenseForm, uploadReceiptForm } from "../../actions";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";
// Route param is the EXPENSE id; its receipt (if any) is itemized here.
// Access is scoped: only participants of the expense can view it (else 404).
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const expense = await getMyExpense(me.id, id).catch(() => null);
  if (!expense) notFound();
  const participants = new Map<string, string>();
  participants.set(expense.paidBy.id, expense.paidBy.name);
  for (const s of expense.splits) participants.set(s.user.id, s.user.name);
  const participantIds = [...participants.keys()];
  const nameOf = (uid: string) => (uid === me.id ? "You" : participants.get(uid) ?? "Former participant");
  const assigneesOf = (it: { assignedToUserIds: string[]; assignedToUserId: string | null }) =>
    it.assignedToUserIds.length > 0 ? it.assignedToUserIds : it.assignedToUserId ? [it.assignedToUserId] : [];
  const itemsTotal = expense.items.reduce((s, it) => s + it.amountInCents, 0);
  const remainder = expense.amountInCents - itemsTotal;
  // Preview of what "Apply itemization" would set (same math as the action).
  let preview: { userId: string; amountOwedInCents: number }[] | null = null;
  if (expense.items.length > 0 && remainder >= 0) {
    preview = itemizedSplits(expense.amountInCents, expense.items.map((it) => ({ amountInCents: it.amountInCents, assignedToUserIds: assigneesOf(it) })), participantIds);
  }
  const isPayer = expense.paidById === me.id;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Receipt — {expense.description}</h1>
      {flashText(sp.notice, "notice") && <div className="rounded-lg border border-brand/40 bg-brand-light px-3 py-2 text-sm text-brand-dark">{flashText(sp.notice, "notice")}</div>}
      {flashText(sp.error, "error") && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{flashText(sp.error, "error")}</div>}
      <p className="text-sm text-neutral-500">
        {formatMoney(expense.amountInCents, expense.currency)} · paid by {nameOf(expense.paidById)} · {expense.date.toISOString().slice(0, 10)}
      </p>
      {expense.voidedAt && (
        <div className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          This expense was <strong>voided</strong>{expense.voidedById ? <> by <strong>{expense.voidedById === me.id ? "you" : participants.get(expense.voidedById) ?? "a participant"}</strong></> : null} on {expense.voidedAt.toISOString().slice(0, 10)} — it no longer counts toward anyone&rsquo;s balances. It is kept here as history.
          {isPayer && (
            <form action={restoreExpenseForm} className="mt-2">
              <input type="hidden" name="expenseId" value={expense.id} />
              <Button type="submit" className="px-3 py-1.5 text-xs">Restore this expense</Button>
              <span className="ml-2 text-xs text-neutral-500">You paid for it, so you can undo the void. The receipt file was removed when it was voided — you can upload it again after restoring.</span>
            </form>
          )}
        </div>
      )}

      {/* Receipt capture: upload a photo (mobile browsers offer the camera)
          or a PDF. The file stays private; only participants can open it. */}
      <Card>
        <h2 className="mb-2 font-semibold">Receipt photo</h2>
        {expense.receipt ? (
          <p className="text-sm text-neutral-500">
            <a className="font-medium text-brand underline" href={`/api/receipts/${expense.receipt.id}`} target="_blank" rel="noreferrer">View receipt image</a>
            {" "}· {(Number(expense.receipt.fileSizeBytes) / 1024).toFixed(0)} KB · uploaded {expense.receipt.uploadedAt.toISOString().slice(0, 10)} (full resolution, private — only expense participants can open it)
          </p>
        ) : (
          <p className="text-sm text-neutral-500">No receipt uploaded yet. Start from the real bill: add a photo of it, then itemize below.</p>
        )}
        {!expense.voidedAt && isPayer && (
          <form action={uploadReceiptForm} encType="multipart/form-data" className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="expenseId" value={id} />
            <div>
              <Label htmlFor="receipt-file">{expense.receipt ? "Replace receipt" : "Upload receipt"}</Label>
              <input id="receipt-file" name="receipt" type="file" accept="image/*,.pdf" capture="environment" required className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-light file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-dark" />
            </div>
            <Button type="submit" variant="secondary">Save receipt</Button>
          </form>
        )}
        {!expense.voidedAt && !isPayer && (
          <p className="mt-2 text-xs text-neutral-400">Only {nameOf(expense.paidById)}, who paid, can manage the receipt file.</p>
        )}
        {!expense.voidedAt && expense.receipt && (
          <ReceiptScanner expenseId={expense.id} receiptId={expense.receipt.id} currency={expense.currency} />
        )}
      </Card>

      {/* Itemization: every line item, assigned to exactly who shared it. */}
      <Card>
        <h2 className="mb-1 font-semibold">Items on this bill</h2>
        {expense.items.length === 0 ? (
          <p className="text-sm text-neutral-500">No items yet. Add the lines from the bill below — assign each one to the people who shared it, and SplitTab works out the rest.</p>
        ) : (
          <>
            {preview && (
              <div className="mb-3 flex flex-wrap gap-2">
                {preview.map((s) => (
                  <span key={s.userId} className="rounded-full bg-app px-3 py-1 text-xs font-medium text-neutral-600">
                    {nameOf(s.userId)}: <b className="text-neutral-800">{formatMoney(s.amountOwedInCents, expense.currency)}</b>
                  </span>
                ))}
                <span className="rounded-full bg-brand-light px-3 py-1 text-xs font-medium text-brand-dark">running totals if itemization is applied</span>
              </div>
            )}
            <div className="divide-y divide-neutral-100">
              {expense.items.map((it) => {
                const assignees = assigneesOf(it);
                return (
                  <div key={it.id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{it.description}</span>
                      <span className="block text-xs text-neutral-500">{assignees.length === 0 ? "Shared by everyone" : `Shared by ${assignees.map(nameOf).join(", ")}`}</span>
                    </span>
                    <b>{formatMoney(it.amountInCents, expense.currency)}</b>
                    {!expense.voidedAt && (
                      <form action={deleteItemForm}>
                        <input type="hidden" name="expenseId" value={id} />
                        <input type="hidden" name="itemId" value={it.id} />
                        <button type="submit" title="Remove item" className="px-1 text-neutral-300 hover:text-red-500">✕</button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between border-t border-neutral-200 pt-2 text-sm">
              <span className="text-neutral-500">Items total</span>
              <b>{formatMoney(itemsTotal, expense.currency)}</b>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">{remainder >= 0 ? "Not itemized (tax, tip, extras — split equally)" : "Items exceed the bill by"}</span>
              <b className={remainder < 0 ? "text-red-600" : ""}>{formatMoney(Math.abs(remainder), expense.currency)}</b>
            </div>
          </>
        )}
      </Card>

      {!expense.voidedAt && (
        <Card>
          <h2 className="mb-2 font-semibold">Add item</h2>
          <form action={addItemForm} className="space-y-3">
            <input type="hidden" name="expenseId" value={id} />
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-44 flex-1"><Label>Description</Label><Input name="description" required maxLength={200} placeholder="e.g. Beef shawarma flatbread" /></div>
              <div><Label>Amount</Label><Input name="amount" type="number" step="0.01" min="0" required className="w-28" /></div>
              <Button type="submit">Add item</Button>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium">Who shared it?</div>
              <div className="flex flex-wrap gap-1.5">
                {participantIds.map((uid) => (
                  <label key={uid} className="cursor-pointer">
                    <input type="checkbox" name="assignedToUserIds" value={uid} className="peer sr-only" />
                    <span className="inline-block rounded-full bg-app px-3 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-neutral-200 transition peer-checked:bg-brand peer-checked:text-white peer-checked:ring-brand">{nameOf(uid)}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-neutral-400">Leave everyone unchecked to split the item across the whole group.</p>
            </div>
          </form>
        </Card>
      )}

      {!expense.voidedAt && expense.items.length > 0 && (
        <Card>
          <h2 className="mb-1 font-semibold">Apply itemization to the split</h2>
          <p className="mb-3 text-sm text-neutral-500">
            So far the items are notes. Applying them rewrites what each person owes for this expense: every item goes to the people who shared it, and the un-itemized remainder ({formatMoney(Math.max(remainder, 0), expense.currency)} of tax, tip and extras) splits equally across everyone.
            {remainder < 0 && <span className="font-medium text-red-600"> The items currently add up to more than the bill — fix that first.</span>}
          </p>
          {isPayer ? (
            <form action={applyItemizationForm}>
              <input type="hidden" name="expenseId" value={id} />
              <Button type="submit" disabled={remainder < 0}>Apply itemized split</Button>
            </form>
          ) : (
            <p className="text-xs text-neutral-400">Only {nameOf(expense.paidById)}, who paid, can apply the itemization.</p>
          )}
        </Card>
      )}

      {!expense.voidedAt && (
      <Card>
        <h2 className="mb-1 font-semibold">Void this expense</h2>
        <p className="mb-3 text-sm text-neutral-500">Voiding stops the expense counting toward balances for everyone, removes its receipt file, and records the change in activity. The expense stays visible as voided history — it is never silently erased.</p>
        <form action={deleteExpenseForm}>
          <input type="hidden" name="expenseId" value={id} />
          <Button type="submit" variant="secondary" className="text-red-600">Void expense</Button>
        </form>
      </Card>
      )}
    </div>
  );
}
