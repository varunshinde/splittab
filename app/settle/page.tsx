import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMyExpenses, getMySettlements } from "@/lib/data";
import { pairwiseNets } from "@/lib/balances";
import { expenseToCurrency, settlementToCurrency } from "@/lib/convert";
import { formatMoney } from "@/lib/format";
import { recordSettlementForm } from "../actions";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Input } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

// Global settle-up: one row per counterparty with an outstanding balance,
// each with a record-payment form (friend-level settlement).
export default async function SettlePage() {
  const me = await requireUser();
  const cur = me.defaultCurrency;
  const [expensesRaw, settlementsRaw] = await Promise.all([getMyExpenses(me.id), getMySettlements(me.id)]);
  const nets = pairwiseNets(
    me.id,
    expensesRaw.map((e) => expenseToCurrency(e, cur)),
    settlementsRaw.map((s) => settlementToCurrency(s, cur)),
  );
  const userById = new Map<string, { name: string; email: string }>();
  for (const e of expensesRaw) {
    userById.set(e.paidBy.id, e.paidBy);
    for (const s of e.splits) userById.set(s.user.id, s.user);
  }
  const rows = [...nets.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Settle up</h1>
      <p className="text-sm text-neutral-500">Record a payment you made or received outside the app (cash, bank transfer, …). Balances update immediately.</p>
      {rows.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="font-semibold text-brand">You&rsquo;re all settled up!</p>
          <p className="text-sm text-neutral-500">No outstanding balances with anyone.</p>
        </Card>
      ) : rows.map(([otherId, net]) => {
        const u = userById.get(otherId);
        if (!u) return null;
        const fromUserId = net > 0 ? otherId : me.id;
        const toUserId = net > 0 ? me.id : otherId;
        return (
          <Card key={otherId} className="flex flex-wrap items-center gap-3">
            <Avatar name={u.name} seed={u.email} />
            <div className="min-w-40 flex-1">
              <div className="font-medium">{u.name}</div>
              <div className={net > 0 ? "text-sm font-semibold text-brand" : "text-sm font-semibold text-owe"}>
                {net > 0 ? `owes you ${formatMoney(net, cur)}` : `you owe ${formatMoney(-net, cur)}`}
              </div>
            </div>
            <form action={recordSettlementForm} className="flex items-end gap-2">
              <input type="hidden" name="fromUserId" value={fromUserId} />
              <input type="hidden" name="toUserId" value={toUserId} />
              <input type="hidden" name="currency" value={cur} />
              <input type="hidden" name="back" value="/settle" />
              <Input name="amount" type="number" step="0.01" min="0.01" defaultValue={(Math.abs(net) / 100).toFixed(2)} className="w-28" aria-label="Amount" />
              <Button type="submit" variant="owe">Record payment</Button>
            </form>
          </Card>
        );
      })}
      <p className="text-center text-sm text-neutral-500">Looking for a specific friend? <Link href="/friends" className="font-semibold text-brand hover:underline">Open Friends</Link></p>
    </div>
  );
}
