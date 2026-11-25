import Link from "next/link";
import { cookies } from "next/headers";
import { DEVICE_CHALLENGE_COOKIE } from "@/lib/device";
import { verifyDeviceAction } from "../auth-actions";
import { Button, Card, Input, Label } from "@/components/ui/ui";
export const dynamic = "force-dynamic";

// Second step of a login from an untrusted device: enter the 6-digit code
// we emailed. The pending challenge is identified by an httpOnly cookie set
// during login; without it there is nothing to verify.
export default async function VerifyDevicePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const challengeId = (await cookies()).get(DEVICE_CHALLENGE_COOKIE)?.value;
  if (!challengeId) {
    return (
      <div className="mx-auto max-w-md py-10">
        <Card className="p-6">
          <h1 className="mb-1 text-2xl font-bold">No sign-in in progress</h1>
          <p className="mb-4 text-sm text-neutral-500">
            This page is the second step of signing in from a new device. Start by logging in — if we
            don&apos;t recognize the device, we&apos;ll email you a code and bring you back here.
          </p>
          <Link href="/login" className="font-semibold text-brand hover:underline">Go to log in</Link>
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="p-6">
        <h1 className="mb-1 text-2xl font-bold">Check your email</h1>
        <p className="mb-4 text-sm text-neutral-500">
          This device isn&apos;t trusted yet, so we emailed a 6-digit sign-in code to your address.
          It expires in 10 minutes.
        </p>
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form action={verifyDeviceAction} className="space-y-3">
          <div>
            <Label htmlFor="code">Sign-in code</Label>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} placeholder="123456" className="text-center text-lg tracking-[0.3em]" />
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" name="trust" defaultChecked className="h-4 w-4 accent-[#1cc29f]" />
            Trust this device (skip the code next time)
          </label>
          <Button type="submit" className="w-full py-2.5">Verify and sign in</Button>
        </form>
        <p className="mt-4 text-center text-sm text-neutral-500">
          Didn&apos;t get it? <Link href="/login" className="font-semibold text-brand hover:underline">Log in again</Link> to request a new code.
        </p>
      </Card>
    </div>
  );
}
