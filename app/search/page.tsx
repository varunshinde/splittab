import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

// Search is scoped to expenses the session user participates in — never the
// whole database.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; min?: string; max?: string; from?: string; participant?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const expenses = await prisma.expense.findMany({
    where: {
      AND: [
        { OR: [{ paidById: me.id }, { splits: { some: { userId: me.id } } }] },
        ...(sp.q ? [{ description: { contains: sp.q, mode: "insensitive" as const } }] : []),
        ...(sp.min || sp.max ? [{ amountInCents: { ...(sp.min ? { gte: Math.round(parseFloat(sp.min) * 100) } : {}), ...(sp.max ? { lte: Math.round(parseFloat(sp.max) * 100) } : {}) } }] : []),
        ...(sp.from ? [{ date: { gte: new Date(sp.from) } }] : []),
        ...(sp.participant ? [{ splits: { some: { user: { name: { contains: sp.participant, mode: "insensitive" as const } } } } }] : []),
      ],
    },
    include: { paidBy: true, group: true, splits: { include: { user: true } } },
    orderBy: { date: "desc" }, take: 200,
  }).catch(() => []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Search your expenses</h1>
      <form className="grid gap-2 md:grid-cols-5">
        <div><Label>Description</Label><Input name="q" defaultValue={sp.q ?? ""} /></div>
        <div><Label>Min $</Label><Input name="min" type="number" step="0.01" /></div>
        <div><Label>Max $</Label><Input name="max" type="number" step="0.01" /></div>
        <div><Label>From date</Label><Input name="from" type="date" /></div>
        <div><Label>Participant name</Label><Input name="participant" defaultValue={sp.participant ?? ""} /></div>
        <Button type="submit">Search</Button>
      </form>
      <div className="space-y-2">
        {expenses.length === 0 && <Card className="p-6 text-center text-sm text-neutral-500">No matching expenses. Try a different search — or <Link href="/expenses/new" className="font-semibold text-brand hover:underline">add an expense</Link>.</Card>}
        {expenses.map((e) => (
          <Card key={e.id} className="py-3">
            <div className="flex justify-between"><span className="font-medium">{e.description} <span className="text-sm font-normal text-neutral-500">{e.group ? `in ${e.group.name}` : "· friend expense"}</span></span><b>{formatMoney(e.amountInCents, e.currency)}</b></div>
            <div className="text-sm text-neutral-500">{e.date.toISOString().slice(0, 10)} · paid by {e.paidById === me.id ? "you" : e.paidBy.name} · {e.splits.map((s) => (s.userId === me.id ? "you" : s.user.name)).join(", ")}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
