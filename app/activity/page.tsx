import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMyExpenses, getMySettlements } from "@/lib/data";
import { formatMoney } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Card } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

// Global activity feed: every expense and settlement the session user is
// part of, newest first. Derived directly from my own records, so it can
// never leak anyone else's activity.
export default async function ActivityPage() {
  const me = await requireUser();
  const [expenses, settlements] = await Promise.all([getMyExpenses(me.id), getMySettlements(me.id)]);
  type ExpenseItem = (typeof expenses)[number];
  type SettlementItem = (typeof settlements)[number];
  type FeedItem =
    | { at: Date; key: string; kind: "expense"; expense: ExpenseItem }
    | { at: Date; key: string; kind: "settlement"; settlement: SettlementItem };
  const feed: FeedItem[] = [
    ...expenses.map((e): FeedItem => ({ at: e.createdAt, key: `e-${e.id}`, kind: "expense", expense: e })),
    ...settlements.map((s): FeedItem => ({ at: s.createdAt, key: `s-${s.id}`, kind: "settlement", settlement: s })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 100);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Activity</h1>
      {feed.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="mb-1 font-semibold">Nothing here yet</p>
          <p className="text-sm text-neutral-500">When you add expenses or settle up, they&rsquo;ll show up here.</p>
          <Link href="/expenses/new" className="mt-3 inline-block font-semibold text-brand hover:underline">Add your first expense</Link>
        </Card>
      ) : (
        <Card className="divide-y divide-neutral-100 p-2">
          {feed.map((item) => item.kind === "expense" ? (
            <div key={item.key} className="flex items-center gap-3 px-2 py-2.5">
              <Avatar name={item.expense.paidBy.name} seed={item.expense.paidBy.email} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {item.expense.paidById === me.id ? "You" : item.expense.paidBy.name} paid for “{item.expense.description}”
                  {item.expense.group && <span className="ml-2 rounded bg-brand-light px-1.5 py-0.5 text-xs font-medium text-brand-dark">{item.expense.group.name}</span>}
                </div>
                <div className="text-xs text-neutral-500">{item.expense.date.toISOString().slice(0, 10)} · split with {item.expense.splits.map((s) => (s.userId === me.id ? "you" : s.user.name)).join(", ")}</div>
              </div>
              <span className="font-semibold">{formatMoney(item.expense.amountInCents, item.expense.currency)}</span>
              {item.expense.receiptId && <Link className="text-sm font-medium text-brand hover:underline" href={`/receipts/${item.expense.id}`}>Receipt</Link>}
            </div>
          ) : (
            <div key={item.key} className="flex items-center gap-3 px-2 py-2.5">
              <Avatar name={item.settlement.fromUser.name} seed={item.settlement.fromUser.email} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {item.settlement.fromUserId === me.id ? "You" : item.settlement.fromUser.name} paid {item.settlement.toUserId === me.id ? "you" : item.settlement.toUser.name}
                  {item.settlement.group && <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600">{item.settlement.group.name}</span>}
                </div>
                <div className="text-xs text-neutral-500">{item.settlement.createdAt.toISOString().slice(0, 10)} · settlement</div>
              </div>
              <span className="font-semibold text-neutral-600">{formatMoney(item.settlement.amountInCents, item.settlement.currency)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
