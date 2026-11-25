import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getMyExpense } from "@/lib/data";
import { formatMoney } from "@/lib/format";
import { ocrReceipt } from "@/lib/ocr";
import { addItemForm, deleteExpenseForm } from "../../actions";
import { Button, Card, Input, Label, selectClass } from "@/components/ui/ui";
export const dynamic = "force-dynamic";
// Route param is the EXPENSE id; its receipt (if any) is itemized here.
// Access is scoped: only participants of the expense can view it (else 404).
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const expense = await getMyExpense(me.id, id).catch(() => null);
  if (!expense) notFound();
  const suggested = expense.receipt ? await ocrReceipt(expense.receipt.filePath) : [];
  const participants = new Map<string, string>();
  participants.set(expense.paidBy.id, expense.paidBy.name);
  for (const s of expense.splits) participants.set(s.user.id, s.user.name);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Receipt — {expense.description}</h1>
      {expense.receipt ? (
        <p className="text-sm text-neutral-500">
          <a className="font-medium text-brand underline" href={`/api/receipts/${expense.receipt.id}`} target="_blank" rel="noreferrer">View receipt image</a>
          {" "}· {expense.receipt.fileSizeBytes.toString()} bytes · uploaded {expense.receipt.uploadedAt.toISOString().slice(0, 10)} (full resolution, private — only expense participants can open it)
        </p>
      ) : (
        <p className="text-sm text-neutral-500">No receipt uploaded for this expense yet.</p>
      )}
      <p className="text-sm text-neutral-500">OCR suggestions: {suggested.length} (stub — itemize manually below)</p>
      <Card>
        {expense.items.length === 0 && <p className="text-sm text-neutral-500">No items yet.</p>}
        {expense.items.map((it) => (
          <div key={it.id} className="flex justify-between py-1"><span>{it.description}</span><span>{formatMoney(it.amountInCents, expense.currency)} {it.assignedTo ? `→ ${it.assignedTo.name}` : "(unassigned)"}</span></div>
        ))}
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Add item</h2>
        <form action={addItemForm} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="expenseId" value={id} />
          <div><Label>Description</Label><Input name="description" required maxLength={200} /></div>
          <div><Label>Amount</Label><Input name="amount" type="number" step="0.01" min="0" required className="w-28" /></div>
          <div><Label>Assign to</Label>
            <select name="assignedToUserId" className={selectClass}><option value="">Unassigned</option>{[...participants.entries()].map(([uid, name]) => <option key={uid} value={uid}>{uid === me.id ? "You" : name}</option>)}</select></div>
          <Button type="submit">Add item</Button>
        </form>
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">Delete this expense</h2>
        <p className="mb-3 text-sm text-neutral-500">Removes the expense and its splits for everyone. This can&rsquo;t be undone.</p>
        <form action={deleteExpenseForm}>
          <input type="hidden" name="expenseId" value={id} />
          <Button type="submit" variant="secondary" className="text-red-600">Delete expense</Button>
        </form>
      </Card>
    </div>
  );
}
