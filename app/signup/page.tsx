import Link from "next/link";
import { flashText } from "@/lib/flash";
import { redirectIfAuthed, signupAction } from "../auth-actions";
import { AuthShell } from "@/components/AuthShell";
import { Button, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

const STEPS = [
  { n: "1", text: "We email you a secure setup link" },
  { n: "2", text: "You set your password from that link" },
  { n: "3", text: "Invite friends and start splitting" },
];

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await redirectIfAuthed();
  const { error } = await searchParams;
  return (
    <AuthShell title="Create your account" subtitle="Free forever for splitting with friends and groups. No password needed yet — we'll email you a link to set one, so the address is verified from the start.">
      {flashText(error, "error") && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{flashText(error, "error")}</div>}
      <form action={signupAction} className="space-y-4">
        <div><Label htmlFor="name">Your name</Label><Input id="name" name="name" required autoComplete="name" placeholder="Alex Rivera" className="py-2.5" /></div>
        <div><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="py-2.5" /></div>
        <Button type="submit" className="w-full py-3 text-base">Email me a setup link</Button>
      </form>

      <ol className="mt-8 space-y-3 border-t border-neutral-100 pt-6">
        {STEPS.map((s) => (
          <li key={s.n} className="flex items-center gap-3 text-sm text-neutral-600">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-black text-brand-dark">{s.n}</span>
            {s.text}
          </li>
        ))}
      </ol>

      <p className="mt-8 text-center text-sm text-neutral-500">
        Already have an account? <Link href="/login" className="font-semibold text-brand hover:underline">Log in</Link>
      </p>
    </AuthShell>
  );
}
