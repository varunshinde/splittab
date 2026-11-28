import { notFound } from "next/navigation";
import { flashText } from "@/lib/flash";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMyGroup } from "@/lib/data";
import { formatMoney } from "@/lib/format";
import { computeBalances, computeSimplifiedDebts } from "@/lib/debt";
import { convertCurrency } from "@/lib/currency";
import { hasProAccess } from "@/lib/pro";
import { acceptGroupInviteForm, addGroupExpenseForm, addGroupMemberForm, confirmSettlementForm, declineGroupInviteForm, grantTripPassForm, leaveGroupForm, recordSettlementForm, rejectSettlementForm, voidSettlementForm } from "../../actions";
import { SpendingCharts } from "@/components/Charts";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Input, Label, selectClass } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function GroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; notice?: string; error?: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab ?? "expenses";
  // Membership-scoped fetch: a non-member gets a 404, never the group's data.
  const group = await getMyGroup(me.id, id).catch(() => null);
  if (!group) notFound();

  // N2: an invited (not yet accepted) user sees ONLY the invitation —
  // no expenses, balances, member list or activity until they accept.
  const myMembership = group.members.find((m) => m.userId === me.id);
  if (myMembership?.status === "INVITED") {
    const inviter = myMembership.invitedById ? group.members.find((m) => m.userId === myMembership.invitedById)?.user : null;
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Group invitation</h1>
        <Card>
          <p className="text-sm text-neutral-600">
            {inviter ? <><strong>{inviter.name}</strong> invited you</> : "You were invited"} to join <strong>{group.name}</strong>.
            If you accept, you become a member and can split expenses in this group from then on. Nothing is charged to you before you accept.
          </p>
          <div className="mt-4 flex gap-2">
            <form action={acceptGroupInviteForm}>
              <input type="hidden" name="groupId" value={id} />
              <Button type="submit">Accept invitation</Button>
            </form>
            <form action={declineGroupInviteForm}>
              <input type="hidden" name="groupId" value={id} />
              <Button type="submit" variant="secondary">Decline</Button>
            </form>
          </div>
        </Card>
      </div>
    );
  }

  const balances = computeBalances(group.expenses);
  // Apply this group's CONFIRMED settlements on top of expense balances
  // (N3: pending settlements move nothing until the other party confirms).
  for (const s of group.settlements) {
    if (s.status !== "CONFIRMED") continue;
    balances.set(s.fromUserId, (balances.get(s.fromUserId) ?? 0) + s.amountInCents);
    balances.set(s.toUserId, (balances.get(s.toUserId) ?? 0) - s.amountInCents);
  }
  const debts = computeSimplifiedDebts(balances);
  const nameOf = (uid: string) => group.members.find((m) => m.userId === uid)?.user.name ?? "Former member";
  const myBalance = balances.get(me.id) ?? 0;

  const byDateMap = new Map<string, number>(); const byCatMap = new Map<string, number>();
  for (const e of group.expenses) {
    const base = convertCurrency(e.amountInCents, e.currency, group.baseCurrency);
    const d = e.date.toISOString().slice(0, 10);
    byDateMap.set(d, (byDateMap.get(d) ?? 0) + base / 100);
    byCatMap.set(e.category, (byCatMap.get(e.category) ?? 0) + base / 100);
  }
  const tabs = [
    { key: "expenses", label: "Expenses" },
    { key: "balances", label: "Balances" },
    { key: "settle", label: "Settle Up" },
    { key: "charts", label: "Charts" },
    { key: "members", label: "Members" },
    { key: "activity", label: "Activity" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-light text-xl font-bold text-brand-dark">{group.name.slice(0, 1).toUpperCase()}</span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <p className="text-sm text-neutral-500">
            Base currency {group.baseCurrency} ·{" "}
            <span className={myBalance > 0 ? "font-semibold text-brand" : myBalance < 0 ? "font-semibold text-owe" : ""}>
              {myBalance === 0 ? "you are settled up in this group" : myBalance > 0 ? `you are owed ${formatMoney(myBalance, group.baseCurrency)}` : `you owe ${formatMoney(-myBalance, group.baseCurrency)}`}
            </span>
          </p>
        </div>
        <Link href={`/expenses/new`}><Button>+ Add expense</Button></Link>
      </div>
      {flashText(sp.notice, "notice") && <div className="rounded-lg border border-brand/40 bg-brand-light px-3 py-2 text-sm text-brand-dark">{flashText(sp.notice, "notice")}</div>}
      {flashText(sp.error, "error") && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{flashText(sp.error, "error")}</div>}

      <nav className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <Link key={t.key} href={`/groups/${id}?tab=${t.key}`} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t.key ? "bg-brand text-white" : "border border-neutral-300 bg-white hover:border-brand"}`}>{t.label}</Link>
        ))}
      </nav>

      {tab === "expenses" && (
        <div className="space-y-4">
          <div className="space-y-2">
            {group.expenses.length === 0 && <Card className="p-6 text-center text-sm text-neutral-500">No expenses in this group yet — add the first one below.</Card>}
            {group.expenses.map((e) => (
              <Card key={e.id} className="py-3">
                <div className="flex justify-between"><span className="font-medium">{e.description} <span className="text-sm font-normal text-neutral-500">({e.category})</span></span><b>{formatMoney(e.amountInCents, e.currency)}</b></div>
                <div className="text-sm text-neutral-500">Paid by {e.paidBy.name} · {e.date.toISOString().slice(0, 10)} · splits: {e.splits.map((s) => `${nameOf(s.userId)} ${formatMoney(s.amountOwedInCents, e.currency)}`).join(", ")}</div>
                {e.notes && <div className="text-sm text-neutral-500">📝 {e.notes}</div>}
                {e.receiptId && <Link className="text-sm font-medium text-brand hover:underline" href={`/receipts/${e.id}`}>Receipt / itemize</Link>}
              </Card>
            ))}
          </div>
          <Card>
            <h2 className="mb-2 font-semibold">Add expense to this group</h2>
            <form action={addGroupExpenseForm} className="space-y-2">
              <input type="hidden" name="groupId" value={id} />
              <div><Label>Description</Label><Input name="description" required maxLength={200} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>Amount</Label><Input name="amount" type="number" step="0.01" min="0.01" required /></div>
                <div><Label>Currency</Label><Input name="currency" defaultValue={group.baseCurrency} maxLength={3} /></div>
                <div><Label>Category</Label><Input name="category" defaultValue="General" maxLength={50} /></div>
              </div>
              <div><Label>Paid by</Label>
                <select name="paidById" className={`${selectClass} w-full`} defaultValue={me.id}>
                  {group.members.filter((m) => m.status === "MEMBER").map((m) => <option key={m.userId} value={m.userId}>{m.userId === me.id ? "You" : m.user.name}</option>)}
                </select></div>
              <div><Label>Split mode</Label>
                <select name="mode" className={`${selectClass} w-full`}><option value="equal">Equal</option><option value="exact">Exact amounts</option><option value="percentage">Percentages</option></select></div>
              <div className="space-y-1 text-sm">
                {group.members.filter((m) => m.status === "MEMBER").map((m) => (
                  <div key={m.userId} className="flex items-center gap-2">
                    <label className="flex w-40 items-center gap-2"><input type="checkbox" name="participantIds" value={m.userId} defaultChecked className="h-4 w-4 accent-[#1cc29f]" /> {m.userId === me.id ? "You" : m.user.name}</label>
                    <Input name={`pct_${m.userId}`} type="number" placeholder="% (percentage mode)" className="w-44" />
                    <Input name={`exact_${m.userId}`} type="number" step="0.01" placeholder="$ (exact mode)" className="w-44" />
                  </div>
                ))}
              </div>
              <Button type="submit">Add expense</Button>
            </form>
          </Card>
        </div>
      )}

      {tab === "balances" && (
        <Card className="divide-y divide-neutral-100 py-2">
          {[...balances.entries()].map(([uid, v]) => (
            <div key={uid} className="flex items-center gap-3 px-2 py-2">
              <Avatar name={nameOf(uid)} size="sm" />
              <span className="flex-1 font-medium">{uid === me.id ? "You" : nameOf(uid)}</span>
              <b className={v > 0 ? "text-brand" : v < 0 ? "text-owe" : "text-neutral-400"}>
                {v === 0 ? "settled up" : v > 0 ? `gets back ${formatMoney(v, group.baseCurrency)}` : `owes ${formatMoney(-v, group.baseCurrency)}`}
              </b>
            </div>
          ))}
        </Card>
      )}

      {tab === "settle" && (
        <Card>
          {debts.length === 0 ? <p className="text-neutral-500">All settled up in this group. 🎉</p> : debts.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border-b border-neutral-100 py-2.5 last:border-0">
              <span className="flex-1">{nameOf(d.from)} → {nameOf(d.to)}: <b>{formatMoney(d.amountInCents, group.baseCurrency)}</b></span>
              {(d.from === me.id || d.to === me.id) && (
                <form action={recordSettlementForm}>
                  <input type="hidden" name="fromUserId" value={d.from} />
                  <input type="hidden" name="toUserId" value={d.to} />
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="currency" value={group.baseCurrency} />
                  <input type="hidden" name="amount" value={(d.amountInCents / 100).toFixed(2)} />
                  <input type="hidden" name="back" value={`/groups/${id}?tab=settle`} />
                  <Button type="submit" variant="owe" className="px-3 py-1.5 text-xs">Record payment</Button>
                </form>
              )}
            </div>
          ))}
          {group.settlements.length > 0 && (
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <h3 className="mb-1 text-sm font-semibold">Recorded payments</h3>
              {group.settlements.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 py-1 text-sm text-neutral-600">
                  <span className="flex-1">{s.fromUser.name} paid {s.toUser.name} <b>{formatMoney(s.amountInCents, s.currency)}</b> · {s.createdAt.toISOString().slice(0, 10)}
                    {s.status === "PENDING" && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">Pending confirmation</span>}
                    {s.status === "VOIDED" && <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold text-neutral-500">Voided</span>}
                  </span>
                  {s.status === "PENDING" && s.recordedById !== me.id && (s.fromUserId === me.id || s.toUserId === me.id) && (
                    <>
                      <form action={confirmSettlementForm}>
                        <input type="hidden" name="settlementId" value={s.id} />
                        <input type="hidden" name="back" value={`/groups/${id}?tab=balances`} />
                        <Button type="submit" className="px-2.5 py-1 text-xs">Confirm</Button>
                      </form>
                      <form action={rejectSettlementForm}>
                        <input type="hidden" name="settlementId" value={s.id} />
                        <input type="hidden" name="back" value={`/groups/${id}?tab=balances`} />
                        <Button type="submit" variant="secondary" className="px-2.5 py-1 text-xs">Reject</Button>
                      </form>
                    </>
                  )}
                  {((s.status === "PENDING" && s.recordedById === me.id) || s.status === "CONFIRMED") && (s.fromUserId === me.id || s.toUserId === me.id) && (
                    <form action={voidSettlementForm}>
                      <input type="hidden" name="settlementId" value={s.id} />
                      <input type="hidden" name="back" value={`/groups/${id}?tab=balances`} />
                      <Button type="submit" variant="ghost" className="px-2.5 py-1 text-xs text-neutral-400 hover:text-red-600">{s.status === "PENDING" ? "Cancel entry" : "Void"}</Button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "charts" && <Card><SpendingCharts byDate={[...byDateMap.entries()].sort().map(([date, amount]) => ({ date, amount }))} byCategory={[...byCatMap.entries()].map(([name, value]) => ({ name, value }))} /></Card>}

      {tab === "members" && (
        <div className="space-y-4">
          <Card className="divide-y divide-neutral-100 py-2">
            {group.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-2 py-2">
                <Avatar name={m.user.name} seed={m.user.email} size="sm" />
                <div className="flex-1">
                  <div className="font-medium">{m.userId === me.id ? "You" : m.user.name}{m.user.isPro ? " · Pro" : ""}</div>
                  <div className="text-xs text-neutral-500">{m.user.email}{m.status === "INVITED" ? " · invitation pending" : m.user.isPlaceholder ? " · invited, not signed up yet" : ""}</div>
                </div>
              </div>
            ))}
          </Card>
          <Card>
            <h2 className="mb-1 font-semibold">Invite a member by email</h2>
            <p className="mb-3 text-sm text-neutral-500">They&rsquo;ll get an invitation and become a member only when they accept — no account needed to be invited. Nothing is charged to them before they accept.</p>
            <form action={addGroupMemberForm} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="groupId" value={id} />
              <div className="min-w-64 flex-1"><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" required placeholder="friend@example.com" /></div>
              <Button type="submit">Send invitation</Button>
            </form>
          </Card>
          <Card>
            <h2 className="mb-1 font-semibold">Leave this group</h2>
            <p className="mb-3 text-sm text-neutral-500">You&rsquo;ll stop seeing new expenses here. Expenses you&rsquo;re already part of stay as history.</p>
            <form action={leaveGroupForm}>
              <input type="hidden" name="groupId" value={id} />
              <Button type="submit" variant="secondary" className="text-red-600">Leave group</Button>
            </form>
          </Card>
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-3">
          <Card>{group.activities.length === 0 ? <p className="text-sm text-neutral-500">No activity yet.</p> : group.activities.map((a) => <div key={a.id} className="py-1 text-sm">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")} — {a.message}</div>)}</Card>
          <Card>
            <h2 className="mb-1 font-semibold">Trip Pass</h2>
            <p className="mb-2 text-sm text-neutral-500">{group.tripPasses.some((p) => hasProAccess({ isPro: false }, [p])) ? "An active Trip Pass gives this group Pro access." : "No active Trip Pass. A Pro member can grant one for 30 days."}</p>
            {me.isPro ? (
              <form action={grantTripPassForm}><input type="hidden" name="groupId" value={id} /><Button type="submit">Grant Trip Pass (as you)</Button></form>
            ) : (
              <p className="text-sm text-neutral-500">You&rsquo;re not a Pro member, so you can&rsquo;t grant a Trip Pass.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
