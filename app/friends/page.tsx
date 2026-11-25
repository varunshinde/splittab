import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getFriends, getMyExpenses, getMySettlements } from "@/lib/data";
import { pairwiseNets } from "@/lib/balances";
import { expenseToCurrency, settlementToCurrency } from "@/lib/convert";
import { formatMoney } from "@/lib/format";
import { addFriendForm, removeFriendForm } from "../actions";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function FriendsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const cur = me.defaultCurrency;
  const [friends, expensesRaw, settlementsRaw] = await Promise.all([
    getFriends(me.id),
    getMyExpenses(me.id),
    getMySettlements(me.id),
  ]);
  const nets = pairwiseNets(
    me.id,
    expensesRaw.map((e) => expenseToCurrency(e, cur)),
    settlementsRaw.map((s) => settlementToCurrency(s, cur)),
  );
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Friends</h1>
      {sp.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sp.error}</div>}
      {sp.notice && <div className="rounded-lg border border-brand/40 bg-brand-light px-3 py-2 text-sm text-brand-dark">{sp.notice}</div>}

      <Card>
        <h2 className="mb-1 font-semibold">Add a friend by email</h2>
        <p className="mb-3 text-sm text-neutral-500">They don&rsquo;t need an account yet — add them now, split expenses right away, and they&rsquo;ll claim everything when they sign up with the same email.</p>
        <form action={addFriendForm} className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1"><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" required placeholder="friend@example.com" /></div>
          <Button type="submit">Add friend</Button>
        </form>
      </Card>

      {friends.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="mb-1 font-semibold">No friends yet</p>
          <p className="text-sm text-neutral-500">Add your first friend by email above, then split an expense with them.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-neutral-100 p-2">
          {friends.map((f) => {
            const net = nets.get(f.id) ?? 0;
            return (
              <div key={f.id} className="flex items-center gap-3 px-2 py-2.5">
                <Avatar name={f.name} seed={f.email} />
                <div className="min-w-0 flex-1">
                  <Link href={`/friends/${f.id}`} className="font-medium hover:text-brand">{f.name}</Link>
                  <div className="truncate text-xs text-neutral-500">{f.email}{f.isPlaceholder ? " · invited, not signed up yet" : ""}</div>
                </div>
                <span className={net > 0 ? "font-semibold text-brand" : net < 0 ? "font-semibold text-owe" : "text-sm text-neutral-400"}>
                  {net === 0 ? "settled up" : net > 0 ? `owes you ${formatMoney(net, cur)}` : `you owe ${formatMoney(-net, cur)}`}
                </span>
                <Link href={`/expenses/new?friend=${f.id}`}><Button variant="secondary" className="px-3 py-1.5 text-xs">+ Expense</Button></Link>
                <form action={removeFriendForm}>
                  <input type="hidden" name="friendId" value={f.id} />
                  <Button type="submit" variant="ghost" className="px-2 py-1.5 text-xs text-neutral-400 hover:text-red-600">Remove</Button>
                </form>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
