import { NextResponse } from "next/server";
import { getUserFromRequest, createServiceClient } from "@/lib/supabase-server";

export async function GET() {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data } = await supabase.from("products").select("brand");

  // Deduplicate and sort
  const brands = [
    ...new Set((data || []).map((row) => row.brand).filter(Boolean)),
  ].sort();

  return NextResponse.json({ brands });
}
