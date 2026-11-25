import { NextRequest, NextResponse } from "next/server";
import { exportData } from "@/app/actions";
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const data = await exportData(userId);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="oss-splitwise-export.json"' },
  });
}
