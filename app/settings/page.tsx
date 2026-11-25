import { prisma } from "@/lib/db";
import { getCurrentUserId, formatMoney } from "@/lib/session";
import { setDefaultSplitForm } from "../actions";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const currentId = await getCurrentUserId();
  const [users, groups, splits] = await Promise.all([
    prisma.user.findMany().catch(() => []),
    prisma.group.findMany().catch(() => []),
    currentId ? prisma.defaultSplit.findMany({ where: { userId: currentId }, include: { group: true, otherUser: true } }).catch(() => []) : Promise.resolve([]),
  ]);
  const me = users.find((u) => u.id === currentId);
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">Settings</h1>
    {me && <Card><div className="font-medium">{me.name}{me.isPro ? " ⭐ Pro" : ""}</div>
      <div className="text-sm text-neutral-500">Default currency: {me.defaultCurrency} · Receipt storage used: {me.receiptStorageUsedBytes.toString()} / {me.receiptStorageQuotaBytes.toString()} bytes</div>
      <a className="mt-2 inline-block underline" href={`/api/export?userId=${me.id}`}>Export all my data (JSON)</a></Card>}
    <Card><h2 className="mb-2 font-semibold">Default split</h2>
      <p className="mb-2 text-sm text-neutral-500">Set your default percentage for a group or a friend; it is auto-applied as the starting split for new expenses.</p>
      <form action={setDefaultSplitForm} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="userId" value={currentId ?? ""} />
        <div><Label>Your %</Label><Input name="percentage" type="number" min="0" max="100" required className="w-24" /></div>
        <div><Label>Group</Label><select name="groupId" className="h-10 rounded-md border px-2"><option value="">—</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        <div><Label>Friend</Label><select name="otherUserId" className="h-10 rounded-md border px-2"><option value="">—</option>{users.filter((u) => u.id !== currentId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <Button type="submit">Save</Button></form>
      <div className="mt-2 text-sm">{splits.map((s) => <div key={s.id}>{s.percentage}% — {s.group ? `group ${s.group.name}` : s.otherUser ? `with ${s.otherUser.name}` : "global"}</div>)}</div></Card>
    <Card><h2 className="font-semibold">Currency conversion</h2><p className="text-sm text-neutral-500">Multi-currency expenses are converted to the group base currency with the static rate table (see lib/currency.ts). Example: {formatMoney(10000, "USD")} in EUR group → converted at seed time by server action <code>convertCurrencyAction</code>.</p></Card>
  </div>);
}
