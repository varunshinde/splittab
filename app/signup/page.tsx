import Link from "next/link";
import { flashText } from "@/lib/flash";
import { redirectIfAuthed, signupAction } from "../auth-actions";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await redirectIfAuthed();
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="p-6">
        <h1 className="mb-1 text-2xl font-bold">Create your account</h1>
        <p className="mb-4 text-sm text-neutral-500">Free forever for splitting with friends and groups. We&apos;ll email you a link to set your password — no password needed yet.</p>
        {flashText(error, "error") && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{flashText(error, "error")}</div>}
        <form action={signupAction} className="space-y-3">
          <div><Label htmlFor="name">Your name</Label><Input id="name" name="name" required autoComplete="name" placeholder="Alex Rivera" /></div>
          <div><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></div>
          <Button type="submit" className="w-full py-2.5">Email me a setup link</Button>
        </form>
        <p className="mt-4 text-center text-sm text-neutral-500">
          Already have an account? <Link href="/login" className="font-semibold text-brand hover:underline">Log in</Link>
        </p>
      </Card>
    </div>
  );
}
