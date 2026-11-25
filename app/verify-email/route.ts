import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth-utils";
import { tokenState } from "@/lib/tokens";

// GET /verify-email?token=... — consumes a verification token: marks the
// account's email as verified and the token as used (single-use), then
// sends the user to /login. Invalid/expired/used tokens get a generic
// error (the resend form on /login is the recovery path).
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("token") ?? "";
  const loginUrl = (params: string) => new URL(`/login?${params}`, req.url);
  const token = raw
    ? await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(raw) } }).catch(() => null)
    : null;
  if (!token || tokenState(token) !== "valid") {
    return NextResponse.redirect(loginUrl(`error=${encodeURIComponent("That verification link is invalid or has expired. Log in to request a new one.")}`));
  }
  await prisma.emailVerificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
  await prisma.user.update({
    where: { id: token.userId },
    data: { emailVerifiedAt: new Date() },
  });
  return NextResponse.redirect(loginUrl(`notice=${encodeURIComponent("Email verified — welcome! You can log in now.")}`));
}
