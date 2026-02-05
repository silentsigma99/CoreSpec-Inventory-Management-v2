import { NextResponse } from "next/server";
import { getUserFromRequest, createServiceClient } from "@/lib/supabase-server";

export async function GET() {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  let query = supabase.from("warehouses").select("*");

  if (user.role === "admin") {
    // Admins see all warehouses
    query = query.order("name");
  } else {
    // Partners see only their warehouse
    if (!user.warehouseId) {
      return NextResponse.json([]);
    }
    query = query.eq("id", user.warehouseId);
  }

  const { data } = await query;

  const warehouses = (data || []).map((w) => ({
    id: w.id,
    name: w.name,
    manager_id: w.manager_id || null,
    is_main: w.is_main ?? false,
    created_at: w.created_at || null,
  }));

  return NextResponse.json(warehouses);
}
