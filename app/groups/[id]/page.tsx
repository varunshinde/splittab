import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/session";
import { computeBalances, computeSimplifiedDebts } from "@/lib/debt";
import { convertCurrency } from "@/lib/currency";
import { hasProAccess } from "@/lib/pro";
import { addExpenseForm, grantTripPassForm } from "../../actions";
import { SpendingCharts } from "@/components/Charts";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function GroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params; const { tab = "expenses" } = await searchParams;
  const group = await prisma.group.findUnique({
    where: { id },
    include: {
      members: { include: { user: true } },
      expenses: { include: { splits: true, paidBy: true, items: true }, orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
      tripPasses: true,
    },
  }).catch(() => null);
  if (!group) notFound();
  const balances = computeBalances(group.expenses);
  const debts = computeSimplifiedDebts(balances);
  const nameOf = (uid: string) => group.members.find((m) => m.userId === uid)?.user.name ?? uid;
  const byDateMap = new Map<string, number>(); const byCatMap = new Map<string, number>();
  for (const e of group.expenses) {
    const base = convertCurrency(e.amountInCents, e.currency, group.baseCurrency);
    const d = e.createdAt.toISOString().slice(0, 10);
    byDateMap.set(d, (byDateMap.get(d) ?? 0) + base / 100);
    byCatMap.set(e.category, (byCatMap.get(e.category) ?? 0) + base / 100);
  }
  const tabs = ["expenses", "balances", "settle", "charts", "activity"];
  return (<div className="space-y-4">
    <h1 className="text-2xl font-bold">{group.name}</h1>
    <p className="text-sm text-neutral-500">Base currency {group.baseCurrency} · {group.members.map((m) => m.user.name + (m.user.isPro ? " (Pro)" : "")).join(", ")}</p>
    <nav className="flex gap-2">{tabs.map((t) => <Link key={t} className={`rounded-md px-3 py-1 text-sm ${tab === t ? "bg-black text-white dark:bg-white dark:text-black" : "border"}`} href={`/groups/${id}?tab=${t}`}>{t}</Link>)}</nav>

    {tab === "expenses" && (<div className="space-y-4">
      <div className="space-y-2">{group.expenses.map((e) => (
        <Card key={e.id}><div className="flex justify-between"><span>{e.description} <span className="text-neutral-500">({e.category})</span></span><b>{formatMoney(e.amountInCents, e.currency)}</b></div>
          <div className="text-sm text-neutral-500">Paid by {e.paidBy.name} · {e.createdAt.toISOString().slice(0, 10)} · splits: {e.splits.map((s) => `${nameOf(s.userId)} ${formatMoney(s.amountOwedInCents, e.currency)}`).join(", ")}</div>
          {e.receiptId && <Link className="text-sm underline" href={`/receipts/${e.id}`}>Receipt / itemize</Link>}
        </Card>))}</div>
      <Card><h2 className="mb-2 font-semibold">Add expense</h2>
        <form action={addExpenseForm} className="space-y-2">
          <input type="hidden" name="groupId" value={id} />
          <div><Label>Description</Label><Input name="description" required /></div>
          <div className="grid grid-cols-3 gap-2"><div><Label>Amount</Label><Input name="amount" type="number" step="0.01" min="0" required /></div>
            <div><Label>Currency</Label><Input name="currency" defaultValue={group.baseCurrency} /></div>
            <div><Label>Category</Label><Input name="category" defaultValue="General" /></div></div>
          <div><Label>Paid by</Label><select name="paidById" className="h-10 rounded-md border px-2">{group.members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}</select></div>
          <div><Label>Split mode</Label><select name="mode" className="h-10 rounded-md border px-2"><option value="equal">Equal</option><option value="exact">Exact amounts</option><option value="percentage">Percentages</option></select></div>
          <div className="space-y-1 text-sm">{group.members.map((m) => (<div key={m.userId} className="flex items-center gap-2">
            <label className="w-32"><input type="checkbox" name="participantIds" value={m.userId} defaultChecked /> {m.user.name}</label>
            <Input name={`pct_${m.userId}`} type="number" placeholder="% (percentage mode)" className="w-32" />
            <Input name={`exact_${m.userId}`} type="number" step="0.01" placeholder="$ (exact mode)" className="w-32" /></div>))}</div>
          <Button type="submit">Add expense</Button></form></Card></div>)}

    {tab === "balances" && <Card>{[...balances.entries()].map(([uid, v]) => <div key={uid} className="flex justify-between py-1"><span>{nameOf(uid)}</span><b>{v === 0 ? "settled" : v > 0 ? `gets back ${formatMoney(v, group.baseCurrency)}` : `owes ${formatMoney(-v, group.baseCurrency)}`}</b></div>)}</Card>}

    {tab === "settle" && <Card>{debts.length === 0 ? <p>All settled up.</p> : debts.map((d, i) => <div key={i} className="py-1">{nameOf(d.from)} → {nameOf(d.to)}: <b>{formatMoney(d.amountInCents, group.baseCurrency)}</b></div>)}</Card>}

    {tab === "charts" && <Card><SpendingCharts byDate={[...byDateMap.entries()].sort().map(([date, amount]) => ({ date, amount }))} byCategory={[...byCatMap.entries()].map(([name, value]) => ({ name, value }))} /></Card>}

    {tab === "activity" && (<div className="space-y-3"><Card>{group.activities.map((a) => <div key={a.id} className="py-1 text-sm">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")} — {a.message}</div>)}</Card>
      <Card><h2 className="mb-1 font-semibold">Trip Pass</h2>
        <p className="mb-2 text-sm text-neutral-500">{group.tripPasses.some((p) => hasProAccess({ isPro: false }, [p])) ? "An active Trip Pass gives this group Pro access." : "No active Trip Pass. A Pro member can grant one for 30 days."}</p>
        <form action={grantTripPassForm}><input type="hidden" name="groupId" value={id} />
          <select name="grantedByUserId" className="mr-2 h-10 rounded-md border px-2">{group.members.filter((m) => m.user.isPro).map((m) => <option key={m.userId} value={m.userId}>{m.user.name} (Pro)</option>)}</select>
          <Button type="submit">Grant Trip Pass</Button></form></Card></div>)}
  </div>);
}
