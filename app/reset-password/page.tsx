import Link from "next/link";
import { flashText } from "@/lib/flash";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth-utils";
import { tokenState } from "@/lib/tokens";
import { resetPasswordAction } from "../auth-actions";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  const token = sp.token
    ? await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(sp.token) } }).catch(() => null)
    : null;
  const valid = tokenState(token) === "valid";
  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="p-6">
        <h1 className="mb-1 text-2xl font-bold">Set a new password</h1>
        {!valid ? (
          <>
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {flashText(sp.error, "error") ?? "That reset link is invalid or has expired."}
            </div>
            <p className="text-sm text-neutral-500">Request a fresh one from the <Link href="/forgot-password" className="font-semibold text-brand hover:underline">forgot password</Link> page.</p>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-neutral-500">Choose a new password (at least 10 characters). This signs out all your sessions.</p>
            {flashText(sp.error, "error") && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{flashText(sp.error, "error")}</div>}
            <form action={resetPasswordAction} className="space-y-3">
              <input type="hidden" name="token" value={sp.token} />
              <div><Label htmlFor="password">New password</Label><Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" /></div>
              <Button type="submit" className="w-full py-2.5">Update password</Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
