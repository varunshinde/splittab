import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { selectUserForm, signOut } from "./actions";
import { Button, Card } from "@/components/ui/ui";
export const dynamic = "force-dynamic";
export default async function Home() {
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } }).catch(() => []);
  const currentId = await getCurrentUserId();
  const current = users.find((u) => u.id === currentId);
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">Select user (MVP session)</h1>
    <p className="text-sm text-neutral-500">No passwords or OAuth in the MVP — pick a user to simulate login. Run the seed script if this list is empty.</p>
    {current && <Card> Signed in as <b>{current.name}</b>{current.isPro ? " (Pro)" : ""}. <form action={signOut}><Button type="submit">Sign out</Button></form></Card>}
    <div className="grid gap-3 md:grid-cols-3">{users.map((u) => (
      <Card key={u.id}><div className="font-medium">{u.name}{u.isPro ? " ⭐ Pro" : ""}</div><div className="text-sm text-neutral-500">{u.email}</div>
        <form action={selectUserForm}><input type="hidden" name="userId" value={u.id} /><Button type="submit" className="mt-2">Select</Button></form></Card>))}
    </div></div>);
}
