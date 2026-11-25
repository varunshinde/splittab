import Link from "next/link";
import { flashText } from "@/lib/flash";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth-utils";
import { tokenState } from "@/lib/tokens";
import { completeSignupAction } from "../auth-actions";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

// Landing page for the emailed setup link. A GET here NEVER consumes the
// token (F9): mail scanners and link prefetchers would otherwise burn it
// before the user clicks. The token is consumed only by the POST that sets
// the password (completeSignupAction), atomically.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token: raw, error } = await searchParams;
  const token = raw
    ? await prisma.emailVerificationToken
        .findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: true } })
        .catch(() => null)
    : null;
  if (!token || tokenState(token) !== "valid") {
    return (
      <div className="mx-auto max-w-md py-10">
        <Card className="p-6">
          <h1 className="mb-1 text-2xl font-bold">That link doesn&apos;t work anymore</h1>
          <p className="mb-4 text-sm text-neutral-500">
            The setup link is invalid, expired, or already used. You can request a fresh one from the login page.
          </p>
          <Link href="/login" className="font-semibold text-brand hover:underline">Go to log in</Link>
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="p-6">
        <h1 className="mb-1 text-2xl font-bold">Set your password</h1>
        <p className="mb-4 text-sm text-neutral-500">
          Your email is confirmed. Choose a password to finish creating your SplitTab account.
        </p>
        {flashText(error, "error") && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{flashText(error, "error")}</div>}
        <form action={completeSignupAction} className="space-y-3">
          <input type="hidden" name="token" value={raw} />
          <div><Label htmlFor="name">Your name</Label><Input id="name" name="name" required autoComplete="name" defaultValue={token.user.name} /></div>
          <div><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" placeholder="At least 10 characters" /></div>
          <Button type="submit" className="w-full py-2.5">Create my account</Button>
        </form>
      </Card>
    </div>
  );
}
