import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getFriends, getMyGroups } from "@/lib/data";
import { describeDevice, deviceHashFor, locationLabel } from "@/lib/device";
import { formatMoney } from "@/lib/format";
import { headers } from "next/headers";
import { setDefaultSplitForm, updateProfileForm } from "../actions";
import { changePasswordAction, revokeTrustedDeviceAction } from "../auth-actions";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Input, Label, selectClass } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const [friends, groups, splits, devices] = await Promise.all([
    getFriends(me.id),
    getMyGroups(me.id),
    prisma.defaultSplit.findMany({ where: { userId: me.id }, include: { group: true, otherUser: true } }).catch(() => []),
    prisma.trustedDevice.findMany({ where: { userId: me.id }, orderBy: { lastSeenAt: "desc" } }).catch(() => []),
  ]);
  const myDeviceHash = deviceHashFor((await headers()).get("user-agent") ?? "");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      {sp.notice && <div className="rounded-lg border border-brand/40 bg-brand-light px-3 py-2 text-sm text-brand-dark">{sp.notice}</div>}
      {sp.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sp.error}</div>}

      <Card>
        <div className="mb-3 flex items-center gap-3">
          <Avatar name={me.name} seed={me.email} size="lg" />
          <div>
            <div className="font-semibold">{me.name}{me.isPro ? <span className="ml-2 rounded bg-brand px-1.5 py-0.5 text-xs font-bold text-white">PRO</span> : null}</div>
            <div className="text-sm text-neutral-500">{me.email}</div>
          </div>
        </div>
        <form action={updateProfileForm} className="flex flex-wrap items-end gap-2">
          <div className="min-w-52 flex-1"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={me.name} required maxLength={100} /></div>
          <div><Label htmlFor="defaultCurrency">Default currency</Label><Input id="defaultCurrency" name="defaultCurrency" defaultValue={me.defaultCurrency} maxLength={3} className="w-24" /></div>
          <Button type="submit">Save profile</Button>
        </form>
        <div className="mt-3 text-sm text-neutral-500">
          Receipt storage used: {(Number(me.receiptStorageUsedBytes) / (1024 * 1024)).toFixed(1)} MB of {(Number(me.receiptStorageQuotaBytes) / (1024 * 1024 * 1024)).toFixed(0)} GB
        </div>
        <a className="mt-2 inline-block font-semibold text-brand hover:underline" href="/api/export">Export all my data (JSON)</a>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Change password</h2>
        <p className="mb-3 text-sm text-neutral-500">Changing your password signs out all your other sessions.</p>
        <form action={changePasswordAction} className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="currentPassword">Current password</Label><Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" /></div>
          <div><Label htmlFor="newPassword">New password</Label><Input id="newPassword" name="newPassword" type="password" required minLength={10} autoComplete="new-password" /></div>
          <Button type="submit" variant="secondary">Change password</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Trusted devices</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Signing in from a device that isn&rsquo;t listed here requires a code we email you. You also get an
          email alert whenever you sign in from a new device or a new location. Remove a device to make it
          ask for a code again.
        </p>
        {devices.length === 0 ? (
          <p className="text-sm text-neutral-500">No trusted devices yet — your next sign-in from each device will ask for a code once.</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {describeDevice(d.userAgent)}
                    {d.deviceHash === myDeviceHash && <span className="ml-2 rounded bg-brand-light px-1.5 py-0.5 text-xs font-semibold text-brand-dark">This device</span>}
                  </div>
                  <div className="truncate text-xs text-neutral-500">
                    {locationLabel({ city: d.city, region: d.region, country: d.country })} · IP {d.ipAddress} · last seen {d.lastSeenAt.toISOString().slice(0, 10)}
                  </div>
                </div>
                <form action={revokeTrustedDeviceAction}>
                  <input type="hidden" name="deviceId" value={d.id} />
                  <Button type="submit" variant="ghost" className="px-2 py-1.5 text-xs text-neutral-400 hover:text-red-600">Remove</Button>
                </form>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Default split</h2>
        <p className="mb-2 text-sm text-neutral-500">Set your default percentage for a group or a friend; it is auto-applied as the starting split for new expenses.</p>
        <form action={setDefaultSplitForm} className="flex flex-wrap items-end gap-2">
          <div><Label>Your %</Label><Input name="percentage" type="number" min="0" max="100" required className="w-24" /></div>
          <div><Label>Group</Label>
            <select name="groupId" className={selectClass}><option value="">—</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div><Label>Friend</Label>
            <select name="otherUserId" className={selectClass}><option value="">—</option>{friends.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
          <Button type="submit">Save</Button>
        </form>
        <div className="mt-2 text-sm">{splits.map((s) => <div key={s.id}>{s.percentage}% — {s.group ? `group ${s.group.name}` : s.otherUser ? `with ${s.otherUser.name}` : "global"}</div>)}</div>
      </Card>

      <Card>
        <h2 className="font-semibold">Currency conversion</h2>
        <p className="text-sm text-neutral-500">Multi-currency expenses are converted to each group&rsquo;s base currency (and to your default currency on the dashboard) with the static rate table in lib/currency.ts. Example: {formatMoney(10000, "USD")} in an EUR group converts at the seeded rates.</p>
      </Card>
    </div>
  );
}
