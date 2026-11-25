import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMyExpense } from "@/lib/data";
import { storage } from "@/lib/storage";
export const dynamic = "force-dynamic";

// Authenticated receipt file serving (F7). Receipt blobs are PRIVATE: the
// stored URL/path grants nothing on its own. Only a signed-in user who is
// the payer or a split participant of the linked expense can fetch the
// bytes, and only through this route.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;
  const receipt = await prisma.receipt
    .findUnique({ where: { id }, include: { expense: true } })
    .catch(() => null);
  if (!receipt || !receipt.expense) return NextResponse.json({ error: "not found" }, { status: 404 });
  const mine = await getMyExpense(me.id, receipt.expense.id).catch(() => null);
  if (!mine) return NextResponse.json({ error: "not found" }, { status: 404 });
  const file = await storage.read(receipt.filePath);
  if (!file) return NextResponse.json({ error: "file unavailable" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
