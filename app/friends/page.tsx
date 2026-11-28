import Link from "next/link";
import { flashText } from "@/lib/flash";
import { requireUser } from "@/lib/auth";
import { getBlockedUsers, getFriendRequests, getFriends, getMyExpenses, getMySettlements } from "@/lib/data";
import { pairwiseNets } from "@/lib/balances";
import { expenseToCurrency, settlementToCurrency } from "@/lib/convert";
import { formatMoney } from "@/lib/format";
import { acceptFriendForm, addFriendForm, blockUserForm, cancelFriendRequestForm, declineFriendForm, removeFriendForm } from "../actions";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function FriendsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const cur = me.defaultCurrency;
  const [friends, requests, blocked, expensesRaw, settlementsRaw] = await Promise.all([
    getFriends(me.id),
    getFriendRequests(me.id),
    getBlockedUsers(me.id),
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
      {flashText(sp.error, "error") && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{flashText(sp.error, "error")}</div>}
      {flashText(sp.notice, "notice") && <div className="rounded-lg border border-brand/40 bg-brand-light px-3 py-2 text-sm text-brand-dark">{flashText(sp.notice, "notice")}</div>}

      <Card>
        <h2 className="mb-1 font-semibold">Add a friend by email</h2>
        <p className="mb-3 text-sm text-neutral-500">Send them a friend request. Once they accept, you can split expenses together. If they don&rsquo;t have an account yet, the request waits for them until they sign up with the same email.</p>
        <form action={addFriendForm} className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1"><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" required placeholder="friend@example.com" /></div>
          <Button type="submit">Send request</Button>
        </form>
      </Card>

      {requests.incoming.length > 0 && (
        <Card className="divide-y divide-neutral-100 p-2">
          <h2 className="px-2 pb-1 pt-2 font-semibold">Friend requests</h2>
          {requests.incoming.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-2 py-2.5">
              <Avatar name={f.name} seed={f.email} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{f.name}</div>
                <div className="truncate text-xs text-neutral-500">{f.email} wants to split expenses with you</div>
              </div>
              <form action={acceptFriendForm}>
                <input type="hidden" name="friendId" value={f.id} />
                <Button type="submit" className="px-3 py-1.5 text-xs">Accept</Button>
              </form>
              <form action={declineFriendForm}>
                <input type="hidden" name="friendId" value={f.id} />
                <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs">Decline</Button>
              </form>
              <form action={blockUserForm}>
                <input type="hidden" name="friendId" value={f.id} />
                <Button type="submit" variant="ghost" className="px-2 py-1.5 text-xs text-neutral-400 hover:text-red-600">Block</Button>
              </form>
            </div>
          ))}
        </Card>
      )}

      {requests.outgoing.length > 0 && (
        <Card className="divide-y divide-neutral-100 p-2">
          <h2 className="px-2 pb-1 pt-2 font-semibold">Requests you sent</h2>
          {requests.outgoing.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-2 py-2.5">
              {/* N6: show only the email I typed — rendering the account's
                  real name here would turn "add a friend" into an
                  email->name lookup oracle. The name appears once they
                  accept and become a friend. */}
              <Avatar name={f.email} seed={f.email} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{f.email}</div>
                <div className="truncate text-xs text-neutral-500">awaiting acceptance</div>
              </div>
              <form action={cancelFriendRequestForm}>
                <input type="hidden" name="friendId" value={f.id} />
                <Button type="submit" variant="ghost" className="px-2 py-1.5 text-xs text-neutral-400 hover:text-red-600">Cancel</Button>
              </form>
            </div>
          ))}
        </Card>
      )}

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
                <form action={blockUserForm}>
                  <input type="hidden" name="friendId" value={f.id} />
                  <Button type="submit" variant="ghost" className="px-2 py-1.5 text-xs text-neutral-400 hover:text-red-600">Block</Button>
                </form>
              </div>
            );
          })}
        </Card>
      )}

      {blocked.length > 0 && (
        <Card className="divide-y divide-neutral-100 p-2">
          <h2 className="px-2 pb-1 pt-2 font-semibold">Blocked</h2>
          {blocked.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-2 py-2.5">
              <Avatar name={f.name} seed={f.email} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{f.name}</div>
                <div className="truncate text-xs text-neutral-500">{f.email} · can&rsquo;t send you requests</div>
              </div>
              <form action={removeFriendForm}>
                <input type="hidden" name="friendId" value={f.id} />
                <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs">Unblock</Button>
              </form>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
