import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/session";
import { ocrReceipt } from "@/lib/ocr";
import { addItemForm } from "../../actions";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";
// Route param is the EXPENSE id; its receipt (if any) is itemized here.
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const expense = await prisma.expense.findUnique({ where: { id }, include: { receipt: true, items: { include: { assignedTo: true } }, group: { include: { members: { include: { user: true } } } } } }).catch(() => null);
  if (!expense) notFound();
  const suggested = expense.receipt ? await ocrReceipt(expense.receipt.filePath) : [];
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">Receipt — {expense.description}</h1>
    {expense.receipt ? <p className="text-sm text-neutral-500">{expense.receipt.filePath} · {expense.receipt.fileSizeBytes.toString()} bytes · uploaded {expense.receipt.uploadedAt.toISOString().slice(0, 10)} (full resolution, local storage)</p> : <p className="text-sm">No receipt uploaded for this expense yet — upload via the <code>uploadReceipt</code> server action.</p>}
    <p className="text-sm text-neutral-500">OCR suggestions: {suggested.length} (stub — itemize manually below)</p>
    <Card>{expense.items.map((it) => <div key={it.id} className="flex justify-between py-1"><span>{it.description}</span><span>{formatMoney(it.amountInCents, expense.currency)} {it.assignedTo ? `→ ${it.assignedTo.name}` : "(unassigned)"}</span></div>)}</Card>
    <Card><h2 className="mb-2 font-semibold">Add item</h2>
      <form action={addItemForm} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="expenseId" value={id} />
        <div><Label>Description</Label><Input name="description" required /></div>
        <div><Label>Amount</Label><Input name="amount" type="number" step="0.01" min="0" required className="w-28" /></div>
        <div><Label>Assign to</Label><select name="assignedToUserId" className="h-10 rounded-md border px-2"><option value="">Unassigned</option>{expense.group.members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}</select></div>
        <Button type="submit">Add item</Button></form></Card></div>);
}
