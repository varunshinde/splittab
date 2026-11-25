import Link from "next/link";
import { flashText } from "@/lib/flash";
import { redirectIfAuthed, loginAction, resendVerificationAction } from "../auth-actions";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; unverified?: string }> }) {
  await redirectIfAuthed();
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="p-6">
        <h1 className="mb-1 text-2xl font-bold">Welcome back</h1>
        <p className="mb-4 text-sm text-neutral-500">Log in to your SplitTab account.</p>
        {flashText(sp.notice, "notice") && <div className="mb-3 rounded-lg border border-brand/40 bg-brand-light px-3 py-2 text-sm text-brand-dark">{flashText(sp.notice, "notice")}</div>}
        {flashText(sp.error, "error") && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{flashText(sp.error, "error")}</div>}
        <form action={loginAction} className="space-y-3">
          <div><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></div>
          <div><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required autoComplete="current-password" /></div>
          <Button type="submit" className="w-full py-2.5">Log in</Button>
        </form>
        <div className="mt-3 flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="font-medium text-brand hover:underline">Forgot password?</Link>
          <span className="text-neutral-500">New here? <Link href="/signup" className="font-semibold text-brand hover:underline">Sign up free</Link></span>
        </div>
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="mb-1 font-semibold">Didn&rsquo;t get the verification email?</h2>
        <p className="mb-3 text-sm text-neutral-500">Enter your email and we&rsquo;ll send a fresh verification link. (For privacy, this always shows the same confirmation.)</p>
        <form action={resendVerificationAction} className="flex items-end gap-2">
          <div className="flex-1"><Label htmlFor="resend-email">Email address</Label><Input id="resend-email" name="email" type="email" required placeholder="you@example.com" /></div>
          <Button type="submit" variant="secondary">Resend</Button>
        </form>
      </Card>
    </div>
  );
}
