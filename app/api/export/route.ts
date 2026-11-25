import { NextResponse } from "next/server";
import { exportData } from "@/app/actions";

// Exports the SESSION user's data only. There is deliberately no userId
// parameter — identity comes from the session cookie (requireUser inside
// exportData redirects/throws for anonymous callers, mapped to 401 here).
export async function GET() {
  try {
    const data = await exportData();
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="splittab-export.json"' },
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
