import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/session";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; min?: string; max?: string; from?: string; participant?: string }> }) {
  const sp = await searchParams;
  const expenses = await prisma.expense.findMany({
    where: {
      ...(sp.q ? { description: { contains: sp.q, mode: "insensitive" as const } } : {}),
      ...(sp.min || sp.max ? { amountInCents: { ...(sp.min ? { gte: Math.round(parseFloat(sp.min) * 100) } : {}), ...(sp.max ? { lte: Math.round(parseFloat(sp.max) * 100) } : {}) } } : {}),
      ...(sp.from ? { createdAt: { gte: new Date(sp.from) } } : {}),
      ...(sp.participant ? { splits: { some: { user: { name: { contains: sp.participant, mode: "insensitive" as const } } } } } : {}),
    },
    include: { paidBy: true, group: true, splits: { include: { user: true } } },
    orderBy: { createdAt: "desc" }, take: 200,
  }).catch(() => []);
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">Search expenses</h1>
    <form className="grid gap-2 md:grid-cols-5">
      <div><Label>Description</Label><Input name="q" defaultValue={sp.q ?? ""} /></div>
      <div><Label>Min $</Label><Input name="min" type="number" step="0.01" /></div>
      <div><Label>Max $</Label><Input name="max" type="number" step="0.01" /></div>
      <div><Label>From date</Label><Input name="from" type="date" /></div>
      <div><Label>Participant name</Label><Input name="participant" defaultValue={sp.participant ?? ""} /></div>
      <Button type="submit">Search</Button></form>
    <div className="space-y-2">{expenses.map((e) => <Card key={e.id}><div className="flex justify-between"><span>{e.description} <span className="text-neutral-500">in {e.group.name}</span></span><b>{formatMoney(e.amountInCents, e.currency)}</b></div>
      <div className="text-sm text-neutral-500">{e.createdAt.toISOString().slice(0, 10)} · paid by {e.paidBy.name} · {e.splits.map((s) => s.user.name).join(", ")}</div></Card>)}</div></div>);
}
