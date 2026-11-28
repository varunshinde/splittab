import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getGroupInvitations, getMyExpenses, getMyGroups, getMySettlements } from "@/lib/data";
import { dashboardTotals, myNet, pairwiseNets } from "@/lib/balances";
import { expenseToCurrency, settlementToCurrency } from "@/lib/convert";
import { convertCurrency } from "@/lib/currency";
import { DonutChart, MonthlyBars } from "@/components/Charts";
import { formatMoney } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Button, Card } from "@/components/ui/ui";
import { acceptGroupInviteForm, blockUserForm, declineGroupInviteForm } from "../actions";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const me = await requireUser();
  const cur = me.defaultCurrency;
  const [expensesRaw, settlementsRaw, groups, invitations] = await Promise.all([
    getMyExpenses(me.id),
    getMySettlements(me.id),
    getMyGroups(me.id),
    getGroupInvitations(me.id),
  ]);
  const expenses = expensesRaw.map((e) => expenseToCurrency(e, cur));
  const settlements = settlementsRaw.map((s) => settlementToCurrency(s, cur));
  const nets = pairwiseNets(me.id, expenses, settlements);
  const totals = dashboardTotals(nets);

  const userById = new Map<string, { name: string; email: string; isPlaceholder: boolean }>();
  for (const e of expensesRaw) {
    userById.set(e.paidBy.id, e.paidBy);
    for (const s of e.splits) userById.set(s.user.id, s.user);
  }
  for (const s of settlementsRaw) {
    userById.set(s.fromUser.id, s.fromUser);
    userById.set(s.toUser.id, s.toUser);
  }
  const owedToMe = [...nets.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const iOwe = [...nets.entries()].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
  const isNewUser = expensesRaw.length === 0 && groups.length === 0;

  // Personal insights: MY share of every non-voided expense (converted to my
  // default currency), by category and by month, plus my largest shares.
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const myCatMap = new Map<string, number>();
  const myMonthMap = new Map<string, number>();
  const myShares: { id: string; description: string; cents: number; date: Date; where: string; href: string }[] = [];
  for (const e of expensesRaw) {
    if (e.voidedAt) continue;
    const mine = e.splits.find((s) => s.userId === me.id);
    if (!mine || mine.amountOwedInCents <= 0) continue;
    const cents = convertCurrency(mine.amountOwedInCents, e.currency, cur);
    myCatMap.set(e.category, (myCatMap.get(e.category) ?? 0) + cents / 100);
    const mk = e.date.toISOString().slice(0, 7);
    myMonthMap.set(mk, (myMonthMap.get(mk) ?? 0) + cents / 100);
    myShares.push({ id: e.id, description: e.description, cents, date: e.date, where: e.group ? e.group.name : "Friend expense", href: e.group ? `/groups/${e.group.id}` : `/receipts/${e.id}` });
  }
  const myByMonth = [...myMonthMap.entries()].sort().slice(-6).map(([key, amount]) => ({ month: `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, amount }));
  const myByCategory = [...myCatMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const myLargest = [...myShares].sort((a, b) => b.cents - a.cents).slice(0, 5);

  const personRow = (userId: string, net: number) => {
    const u = userById.get(userId);
    if (!u) return null;
    return (
      <Link key={userId} href={`/friends/${userId}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-neutral-50">
        <Avatar name={u.name} seed={u.email} size="sm" />
        <span className="min-w-0 flex-1 truncate font-medium">{u.name}{u.isPlaceholder ? <span className="ml-1 text-xs font-normal text-neutral-400">(invited)</span> : null}</span>
        <span className={net > 0 ? "font-semibold text-brand" : "font-semibold text-owe"}>
          {net > 0 ? `owes you ${formatMoney(net, cur)}` : `you owe ${formatMoney(-net, cur)}`}
        </span>
      </Link>
    );
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {invitations.length > 0 && (
        <Card className="border-brand/40 bg-brand-light/40">
          <h2 className="mb-2 font-semibold">Group invitations</h2>
          <div className="space-y-2">
            {invitations.map(({ group, invitedById, invitedByName }) => (
              <div key={group.id} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-sm">
                  <strong>{group.name}</strong>{invitedByName ? <> — invited by {invitedByName}</> : null}
                </span>
                <form action={acceptGroupInviteForm}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <Button type="submit" className="px-3 py-1.5 text-xs">Accept</Button>
                </form>
                <form action={declineGroupInviteForm}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs">Decline</Button>
                </form>
                {invitedById && (
                  <form action={blockUserForm}>
                    <input type="hidden" name="friendId" value={invitedById} />
                    <Button type="submit" variant="ghost" className="px-3 py-1.5 text-xs text-neutral-400 hover:text-red-600">Block inviter</Button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="grid grid-cols-3 divide-x divide-neutral-200 p-0 text-center">
        <div className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Total balance</div>
          <div className={`mt-1 text-lg font-bold ${totals.total > 0 ? "text-brand" : totals.total < 0 ? "text-owe" : "text-neutral-500"}`}>
            {totals.total === 0 ? formatMoney(0, cur) : totals.total > 0 ? `+${formatMoney(totals.total, cur)}` : `-${formatMoney(-totals.total, cur)}`}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">You owe</div>
          <div className="mt-1 text-lg font-bold text-owe">{formatMoney(totals.youOwe, cur)}</div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">You are owed</div>
          <div className="mt-1 text-lg font-bold text-brand">{formatMoney(totals.youAreOwed, cur)}</div>
        </div>
      </Card>

      {!isNewUser && myShares.length > 0 && (
        <>
          <Card>
            <h2 className="mb-3 font-semibold">Your spending insights</h2>
            <div className="grid gap-6 md:grid-cols-2">
              <MonthlyBars data={myByMonth} title="Your share by month" />
              <DonutChart data={myByCategory} title="Your share by category" />
            </div>
          </Card>
          <Card>
            <h2 className="mb-1 font-semibold">Your largest expenses</h2>
            <p className="mb-2 text-sm text-neutral-500">Ranked by your share of each bill, in {cur}.</p>
            <div className="divide-y divide-neutral-100">
              {myLargest.map((s, i) => (
                <Link key={s.id} href={s.href} className="flex items-center gap-3 py-2 hover:bg-neutral-50">
                  <span className="w-6 text-sm font-bold text-neutral-400">#{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.description}</span>
                    <span className="block text-xs text-neutral-500">{s.where} · {s.date.toISOString().slice(0, 10)}</span>
                  </span>
                  <span className="text-sm text-neutral-500">your share</span>
                  <b>{formatMoney(s.cents, cur)}</b>
                </Link>
              ))}
            </div>
          </Card>
        </>
      )}

      {isNewUser && (
        <Card className="border-brand/40 bg-brand-light p-6 text-center">
          <h2 className="mb-1 text-lg font-bold">Welcome to SplitTab, {me.name.split(" ")[0]}!</h2>
          <p className="mx-auto mb-4 max-w-md text-sm text-neutral-600">You have no expenses yet. Add a friend by email or create a group for a trip or your home, then record your first shared expense.</p>
          <div className="flex justify-center gap-2">
            <Link href="/friends"><Button>Add your first friend</Button></Link>
            <Link href="/groups"><Button variant="secondary">Create a group</Button></Link>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold text-owe">You owe</h2>
          {iOwe.length === 0 ? <p className="text-sm text-neutral-500">You don&rsquo;t owe anyone right now.</p> : iOwe.map(([id, v]) => personRow(id, v))}
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold text-brand">You are owed</h2>
          {owedToMe.length === 0 ? <p className="text-sm text-neutral-500">Nobody owes you right now.</p> : owedToMe.map(([id, v]) => personRow(id, v))}
        </Card>
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Your groups</h2>
          <Link href="/groups" className="text-sm font-semibold text-brand hover:underline">View all</Link>
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-neutral-500">No groups yet. <Link href="/groups" className="font-semibold text-brand hover:underline">Create one</Link> for a trip, home or couple.</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {groups.map((g) => {
              const net = myNet(me.id, g.expenses.map((e) => expenseToCurrency(e, g.baseCurrency)), g.settlements);
              return (
                <Link key={g.id} href={`/groups/${g.id}`} className="flex items-center gap-3 py-2.5 hover:bg-neutral-50">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light text-sm font-bold text-brand-dark">{g.name.slice(0, 1).toUpperCase()}</span>
                  <span className="flex-1 font-medium">{g.name}</span>
                  <span className={net > 0 ? "font-semibold text-brand" : net < 0 ? "font-semibold text-owe" : "text-sm text-neutral-400"}>
                    {net === 0 ? "settled up" : net > 0 ? `you are owed ${formatMoney(net, g.baseCurrency)}` : `you owe ${formatMoney(-net, g.baseCurrency)}`}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
