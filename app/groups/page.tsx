import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { createGroupForm } from "../actions";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";
export default async function GroupsPage() {
  const currentId = await getCurrentUserId();
  const [groups, users] = await Promise.all([
    prisma.group.findMany({ include: { members: { include: { user: true } }, _count: { select: { expenses: true } } }, orderBy: { createdAt: "desc" } }).catch(() => []),
    prisma.user.findMany().catch(() => []),
  ]);
  return (<div className="space-y-6"><h1 className="text-2xl font-bold">Groups</h1>
    <div className="grid gap-3 md:grid-cols-2">{groups.map((g) => (
      <Card key={g.id}><Link className="font-medium underline" href={`/groups/${g.id}`}>{g.name}</Link>
        <div className="text-sm text-neutral-500">{g.baseCurrency} · {g._count.expenses} expenses · members: {g.members.map((m) => m.user.name).join(", ")}</div></Card>))}
    </div>
    <Card><h2 className="mb-2 font-semibold">Create group</h2>
      <form action={createGroupForm} className="space-y-2">
        <input type="hidden" name="creatorId" value={currentId ?? users[0]?.id ?? ""} />
        <div><Label htmlFor="name">Name</Label><Input id="name" name="name" required placeholder="Trip to Paris" /></div>
        <div><Label htmlFor="baseCurrency">Base currency</Label><Input id="baseCurrency" name="baseCurrency" defaultValue="USD" /></div>
        <div className="text-sm">{users.filter((u) => u.id !== currentId).map((u) => (<label key={u.id} className="mr-3"><input type="checkbox" name="memberIds" value={u.id} /> {u.name}</label>))}</div>
        <Button type="submit">Create</Button></form></Card></div>);
}
