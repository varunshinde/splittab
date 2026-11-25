import { requireUser } from "@/lib/auth";
import { getFriends, getMyGroups } from "@/lib/data";
import { AddExpenseForm } from "@/components/AddExpenseForm";
import { Card } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<{ friend?: string; error?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const [friends, groups] = await Promise.all([getFriends(me.id), getMyGroups(me.id)]);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Add an expense</h1>
      {sp.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sp.error}</div>}
      <Card className="p-5">
        <AddExpenseForm
          me={{ id: me.id, name: me.name, email: me.email }}
          friends={friends.map((f) => ({ id: f.id, name: f.name, email: f.email, isPlaceholder: f.isPlaceholder }))}
          groups={groups.map((g) => ({
            id: g.id, name: g.name, baseCurrency: g.baseCurrency,
            members: g.members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, isPlaceholder: m.user.isPlaceholder })),
          }))}
          preselectedFriendId={sp.friend && friends.some((f) => f.id === sp.friend) ? sp.friend : undefined}
        />
      </Card>
    </div>
  );
}
