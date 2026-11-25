import Link from "next/link";
import { flashText } from "@/lib/flash";
import { redirectIfAuthed, forgotPasswordAction } from "../auth-actions";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await redirectIfAuthed();
  const { notice } = await searchParams;
  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="p-6">
        <h1 className="mb-1 text-2xl font-bold">Forgot your password?</h1>
        <p className="mb-4 text-sm text-neutral-500">Enter your account email and we&rsquo;ll send you a reset link (valid for 1 hour). For privacy, this page always shows the same confirmation whether or not the email has an account.</p>
        {flashText(notice, "notice") && <div className="mb-3 rounded-lg border border-brand/40 bg-brand-light px-3 py-2 text-sm text-brand-dark">{flashText(notice, "notice")}</div>}
        <form action={forgotPasswordAction} className="space-y-3">
          <div><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></div>
          <Button type="submit" className="w-full py-2.5">Send reset link</Button>
        </form>
        <p className="mt-4 text-center text-sm text-neutral-500">
          Remembered it? <Link href="/login" className="font-semibold text-brand hover:underline">Log in</Link>
        </p>
      </Card>
    </div>
  );
}
