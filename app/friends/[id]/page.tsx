import Link from "next/link";
import { flashText } from "@/lib/flash";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { findFriendship } from "@/lib/data";
import { netBetween } from "@/lib/balances";
import { renderActivity, userLabel, type LabelUser } from "@/lib/activity-render";
import { formatMoney } from "@/lib/format";
import { confirmSettlementForm, confirmVoidSettlementForm, rejectSettlementForm, rejectVoidSettlementForm, settleFriendForm, voidSettlementForm } from "../../actions";
import { Avatar } from "@/components/Avatar";
import { DonutChart, MonthlyBars } from "@/components/Charts";
import { convertCurrency } from "@/lib/currency";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function FriendPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const me = await requireUser();
  const { id: friendId } = await params;
  const { notice } = await searchParams;
  const friendship = await findFriendship(me.id, friendId).catch(() => null);
  // R3: only an ACCEPTED friendship opens this page. A PENDING request
  // must not turn the URL into a name/registration lookup (the sender
  // learns the page exists the moment the target accepts — not before).
  if (!friendship || friendship.status !== "ACCEPTED") notFound();
  const friend = await prisma.user.findUnique({ where: { id: friendId } });
  if (!friend) notFound();

  // History: expenses where one of us paid and both of us are involved,
  // plus settlements between us (friend-level and group-level alike).
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: {
        OR: [
          { paidById: me.id, splits: { some: { userId: friendId } } },
          { paidById: friendId, splits: { some: { userId: me.id } } },
          // Group expenses paid by a third person where we both have splits:
          { splits: { some: { userId: me.id } }, AND: { splits: { some: { userId: friendId } } } },
        ],
      },
      include: { splits: true, paidBy: true, group: true },
      orderBy: { date: "desc" },
      take: 100,
    }),
    prisma.settlement.findMany({
      where: { OR: [{ fromUserId: me.id, toUserId: friendId }, { fromUserId: friendId, toUserId: me.id }] },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const cur = me.defaultCurrency;
  const net = netBetween(me.id, friendId, expenses, settlements);
  // R7: friend-level activity (voids, restores, settlement events) was
  // written but shown nowhere — surface it here for the pair.
  const pairActivity = await prisma.activity.findMany({
    where: {
      groupId: null,
      OR: [
        { userId: me.id, subjectId: friendId },
        { userId: friendId, subjectId: me.id },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  }).catch(() => []);
  const pairLabelOf = (userId: string | null) =>
    userLabel(userId === me.id ? (me as LabelUser) : userId === friendId ? (friend as LabelUser) : undefined, me.id);
  const history = [
    ...expenses.map((e) => ({ kind: "expense" as const, at: e.date, expense: e })),
    ...settlements.map((s) => ({ kind: "settlement" as const, at: s.createdAt, settlement: s })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  // Pair insights: everything the two of us share (friend + group expenses),
  // converted to my currency — shared volume by month and category, and who
  // fronted it. Voided expenses are history only and excluded.
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pairMonthMap = new Map<string, number>();
  const pairCatMap = new Map<string, number>();
  const pairPayerMap = new Map<string, number>();
  for (const e of expenses) {
    if (e.voidedAt) continue;
    const base = convertCurrency(e.amountInCents, e.currency, cur) / 100;
    const mk = e.date.toISOString().slice(0, 7);
    pairMonthMap.set(mk, (pairMonthMap.get(mk) ?? 0) + base);
    pairCatMap.set(e.category, (pairCatMap.get(e.category) ?? 0) + base);
    const payerName = e.paidById === me.id ? "You" : e.paidById === friendId ? friend.name : e.paidBy.name;
    pairPayerMap.set(payerName, (pairPayerMap.get(payerName) ?? 0) + base);
  }
  const pairByMonth = [...pairMonthMap.entries()].sort().slice(-6).map(([key, amount]) => ({ month: `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, amount }));
  const pairByCategory = [...pairCatMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const pairByPayer = [...pairPayerMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={friend.name} seed={friend.email} size="lg" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{friend.name}</h1>
          <div className="text-sm text-neutral-500">{friend.email}{friend.isPlaceholder ? " · invited, not signed up yet" : ""}</div>
        </div>
        <Link href={`/expenses/new?friend=${friend.id}`}><Button>+ Add expense</Button></Link>
      </div>
      {flashText(notice, "notice") && <div className="rounded-lg border border-brand/40 bg-brand-light px-3 py-2 text-sm text-brand-dark">{flashText(notice, "notice")}</div>}

      <Card className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <div className="text-sm text-neutral-500">Overall balance</div>
          <div className={`text-xl font-bold ${net > 0 ? "text-brand" : net < 0 ? "text-owe" : "text-neutral-500"}`}>
            {net === 0 ? "You are settled up" : net > 0 ? `${friend.name} owes you ${formatMoney(net, cur)}` : `You owe ${friend.name} ${formatMoney(-net, cur)}`}
          </div>
          <div className="text-xs text-neutral-400">Across the expenses you two share (friend and group) and your settlements.</div>
        </div>
        {net !== 0 && (
          <form action={settleFriendForm} className="flex items-end gap-2">
            <input type="hidden" name="friendId" value={friend.id} />
            <div><Label htmlFor="amount">Settle amount ({cur})</Label><Input id="amount" name="amount" type="number" step="0.01" min="0" defaultValue={(Math.abs(net) / 100).toFixed(2)} className="w-32" /></div>
            <Button type="submit" variant="owe">Settle up</Button>
          </form>
        )}
      </Card>

      {pairByMonth.length > 0 && (
        <Card>
          <h2 className="mb-3 font-semibold">You &amp; {friend.name} in numbers</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <MonthlyBars data={pairByMonth} title="Shared spending by month" />
            <DonutChart data={pairByCategory} title="Shared spending by category" />
          </div>
          {pairByPayer.length > 0 && (
            <div className="mt-4 border-t border-neutral-100 pt-3">
              <div className="mb-1 text-sm font-medium">Who fronted it</div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600">
                {pairByPayer.map((p) => (
                  <span key={p.name}>{p.name}: <b className="text-neutral-800">{formatMoney(Math.round(p.value * 100), cur)}</b></span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="space-y-2">
        {history.length === 0 && <Card className="p-6 text-center text-sm text-neutral-500">No expenses with {friend.name} yet. <Link href={`/expenses/new?friend=${friend.id}`} className="font-semibold text-brand hover:underline">Add the first one</Link>.</Card>}
        {history.map((h) => h.kind === "expense" ? (
          <Card key={`e-${h.expense.id}`} className="flex items-center gap-3 py-3">
            <div className="flex-1">
              <div className="font-medium">{h.expense.description}{h.expense.group ? <span className="ml-2 rounded bg-brand-light px-1.5 py-0.5 text-xs font-medium text-brand-dark">{h.expense.group.name}</span> : null}{h.expense.voidedAt ? <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold text-neutral-500">Voided</span> : null}</div>
              <div className="text-xs text-neutral-500">{h.expense.date.toISOString().slice(0, 10)} · {h.expense.paidById === me.id ? "You" : friend.name} paid {formatMoney(h.expense.amountInCents, h.expense.currency)}{h.expense.voidedAt ? ` · voided by ${h.expense.voidedById === me.id ? "you" : h.expense.voidedById === friend.id ? friend.name : "a participant"} on ${h.expense.voidedAt.toISOString().slice(0, 10)} — no longer counts` : ""}</div>
            </div>
            {h.expense.voidedAt ? (
              <span className="text-sm font-medium text-neutral-400 line-through">{formatMoney(h.expense.amountInCents, h.expense.currency)}</span>
            ) : (() => {
              const myShare = h.expense.splits.find((s) => s.userId === me.id)?.amountOwedInCents ?? 0;
              const theirShare = h.expense.splits.find((s) => s.userId === friendId)?.amountOwedInCents ?? 0;
              const delta = h.expense.paidById === me.id ? theirShare : -myShare;
              return <span className={delta > 0 ? "font-semibold text-brand" : delta < 0 ? "font-semibold text-owe" : "text-sm text-neutral-400"}>
                {delta === 0 ? "not involved" : delta > 0 ? `owes you ${formatMoney(delta, h.expense.currency)}` : `you owe ${formatMoney(-delta, h.expense.currency)}`}
              </span>;
            })()}
            {h.expense.receiptId && <Link className="text-sm font-medium text-brand hover:underline" href={`/receipts/${h.expense.id}`}>Receipt</Link>}
          </Card>
        ) : (
          <Card key={`s-${h.settlement.id}`} className="flex items-center gap-3 py-3">
            <div className="flex-1">
              <div className="font-medium">
                Settlement
                {h.settlement.status === "PENDING" && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">Pending confirmation</span>}
                {h.settlement.status === "VOIDED" && <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold text-neutral-500">Voided</span>}
                {h.settlement.status === "VOID_REQUESTED" && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">Void requested</span>}
              </div>
              <div className="text-xs text-neutral-500">{h.settlement.createdAt.toISOString().slice(0, 10)} · {h.settlement.fromUserId === me.id ? "You" : friend.name} paid {h.settlement.toUserId === me.id ? "you" : friend.name}{h.settlement.status === "PENDING" ? " · doesn't count until confirmed" : ""}</div>
              {h.settlement.status === "PENDING" && h.settlement.recordedById !== me.id && (
                <div className="mt-1.5 flex gap-2">
                  <form action={confirmSettlementForm}>
                    <input type="hidden" name="settlementId" value={h.settlement.id} />
                    <input type="hidden" name="back" value={`/friends/${friendId}`} />
                    <Button type="submit" className="px-2.5 py-1 text-xs">Confirm</Button>
                  </form>
                  <form action={rejectSettlementForm}>
                    <input type="hidden" name="settlementId" value={h.settlement.id} />
                    <input type="hidden" name="back" value={`/friends/${friendId}`} />
                    <Button type="submit" variant="secondary" className="px-2.5 py-1 text-xs">Reject</Button>
                  </form>
                </div>
              )}
              {h.settlement.status === "PENDING" && h.settlement.recordedById === me.id && (
                <form action={voidSettlementForm} className="mt-1.5">
                  <input type="hidden" name="settlementId" value={h.settlement.id} />
                  <input type="hidden" name="back" value={`/friends/${friendId}`} />
                  <Button type="submit" variant="ghost" className="px-2.5 py-1 text-xs text-neutral-400 hover:text-red-600">Cancel entry</Button>
                </form>
              )}
              {h.settlement.status === "CONFIRMED" && (
                <form action={voidSettlementForm} className="mt-1.5">
                  <input type="hidden" name="settlementId" value={h.settlement.id} />
                  <input type="hidden" name="back" value={`/friends/${friendId}`} />
                  <Button type="submit" variant="ghost" className="px-2.5 py-1 text-xs text-neutral-400 hover:text-red-600">Request void</Button>
                </form>
              )}
              {h.settlement.status === "VOID_REQUESTED" && h.settlement.voidRequestedById !== me.id && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs text-neutral-500">{friend.name} asked to void this settlement. It keeps counting unless you agree.</span>
                  <form action={confirmVoidSettlementForm}>
                    <input type="hidden" name="settlementId" value={h.settlement.id} />
                    <input type="hidden" name="back" value={`/friends/${friendId}`} />
                    <Button type="submit" className="px-2.5 py-1 text-xs">Agree to void</Button>
                  </form>
                  <form action={rejectVoidSettlementForm}>
                    <input type="hidden" name="settlementId" value={h.settlement.id} />
                    <input type="hidden" name="back" value={`/friends/${friendId}`} />
                    <Button type="submit" variant="secondary" className="px-2.5 py-1 text-xs">Keep it</Button>
                  </form>
                </div>
              )}
              {h.settlement.status === "VOID_REQUESTED" && h.settlement.voidRequestedById === me.id && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs text-neutral-500">You asked to void this — it keeps counting until {friend.name} agrees.</span>
                  <form action={rejectVoidSettlementForm}>
                    <input type="hidden" name="settlementId" value={h.settlement.id} />
                    <input type="hidden" name="back" value={`/friends/${friendId}`} />
                    <Button type="submit" variant="ghost" className="px-2.5 py-1 text-xs text-neutral-400">Withdraw request</Button>
                  </form>
                </div>
              )}
            </div>
            <span className={`font-semibold ${h.settlement.status === "VOIDED" ? "text-neutral-400 line-through" : "text-neutral-600"}`}>{formatMoney(h.settlement.amountInCents, h.settlement.currency)}</span>
          </Card>
        ))}
      </div>

      {pairActivity.length > 0 && (
        <Card>
          <h2 className="mb-1 font-semibold">Activity</h2>
          {pairActivity.map((a) => (
            <div key={a.id} className="py-1 text-sm text-neutral-600">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")} — {renderActivity(a, pairLabelOf)}</div>
          ))}
        </Card>
      )}
    </div>
  );
}
