import { NextResponse } from "next/server";

export async function GET() {
  // #region agent log
  console.log("[RAILWAY_DEBUG] /api/health hit - request reached the app");
  // #endregion
  return NextResponse.json({ ok: true });
}
