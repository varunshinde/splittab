import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMyGroups } from "@/lib/data";
import { myNet } from "@/lib/balances";
import { expenseToCurrency } from "@/lib/convert";
import { formatMoney } from "@/lib/format";
import { createGroupForm } from "../actions";
import { Button, Card, Input, Label, selectClass, textareaClass } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

const GROUP_TYPES = [
  { value: "trip", label: "✈️ Trip" },
  { value: "house", label: "🏠 House" },
  { value: "apartment", label: "🏢 Apartment" },
  { value: "couple", label: "💑 Couple" },
  { value: "other", label: "📋 Other" },
];

export default async function GroupsPage() {
  const me = await requireUser();
  const groups = await getMyGroups(me.id);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Groups</h1>
      {groups.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="mb-1 font-semibold">No groups yet</p>
          <p className="text-sm text-neutral-500">Create a group for a trip, a home or a couple — then invite people by email.</p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((g) => {
            const net = myNet(me.id, g.expenses.map((e) => expenseToCurrency(e, g.baseCurrency)), g.settlements);
            return (
              <Card key={g.id} className="hover:border-brand/50">
                <Link href={`/groups/${g.id}`} className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-light text-lg font-bold text-brand-dark">{g.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{g.name}</span>
                    <span className="block text-xs text-neutral-500">{GROUP_TYPES.find((t) => t.value === g.type)?.label ?? g.type} · {g.members.length} members · {g.expenses.length} expenses</span>
                  </span>
                  <span className={net > 0 ? "font-semibold text-brand" : net < 0 ? "font-semibold text-owe" : "text-sm text-neutral-400"}>
                    {net === 0 ? "settled up" : net > 0 ? `+${formatMoney(net, g.baseCurrency)}` : `-${formatMoney(-net, g.baseCurrency)}`}
                  </span>
                </Link>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <h2 className="mb-3 font-semibold">Create a group</h2>
        <form action={createGroupForm} className="space-y-3">
          <div><Label htmlFor="name">Group name</Label><Input id="name" name="name" required maxLength={100} placeholder="Trip to Paris" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="type">Type</Label>
              <select id="type" name="type" className={`${selectClass} w-full`} defaultValue="trip">
                {GROUP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select></div>
            <div><Label htmlFor="baseCurrency">Base currency</Label><Input id="baseCurrency" name="baseCurrency" defaultValue="USD" maxLength={3} /></div>
          </div>
          <div><Label htmlFor="inviteEmails">Invite members by email (optional)</Label>
            <textarea id="inviteEmails" name="inviteEmails" rows={2} className={textareaClass} placeholder="friend@example.com, other@example.com" />
            <p className="mt-1 text-xs text-neutral-400">People without an account are added as invited members — their share is tracked and claimed when they sign up.</p></div>
          <Button type="submit">Create group</Button>
        </form>
      </Card>
    </div>
  );
}
