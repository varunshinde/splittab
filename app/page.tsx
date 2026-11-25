import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Button, Card } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-10 text-center">
      <div className="space-y-3">
        <img src="/logo-mark.svg" alt="SplitTab logo" className="mx-auto h-20 w-20" />
        <h1 className="text-4xl font-black tracking-tight">Split expenses, <span className="text-brand">without the awkward math.</span></h1>
        <p className="mx-auto max-w-xl text-neutral-600">
          SplitTab is a free, open-source way to track shared expenses with friends and groups —
          dinners, trips, rent and everything in between. Everyone sees who owes whom, and settling up takes seconds.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Link href="/signup"><Button className="px-6 py-3 text-base">Sign up free</Button></Link>
          <Link href="/login"><Button variant="secondary" className="px-6 py-3 text-base">Log in</Button></Link>
        </div>
      </div>
      <div className="grid gap-3 text-left md:grid-cols-3">
        <Card><div className="mb-1 font-semibold text-brand">Friends by email</div><p className="text-sm text-neutral-600">Add anyone by email — even before they sign up. Their share is waiting when they join.</p></Card>
        <Card><div className="mb-1 font-semibold text-brand">Groups for trips & homes</div><p className="text-sm text-neutral-600">Track a whole trip or household in one place, with balances and simplified settle-up.</p></Card>
        <Card><div className="mb-1 font-semibold text-brand">Receipts, charts & export</div><p className="text-sm text-neutral-600">Attach receipts, itemize them, see spending charts, and export your data any time.</p></Card>
      </div>
    </div>
  );
}
