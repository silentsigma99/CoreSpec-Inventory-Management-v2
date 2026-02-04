import { NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
} from "@/lib/supabase-server";

export async function GET() {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  // Get warehouse name if user has one
  let warehouseName: string | null = null;
  if (user.warehouseId) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("warehouses")
      .select("name")
      .eq("id", user.warehouseId)
      .single();

    if (data) {
      warehouseName = data.name;
    }
  }

  return NextResponse.json({
    id: user.userId,
    role: user.role,
    full_name: user.email,
    warehouse_id: user.warehouseId,
    warehouse_name: warehouseName,
  });
}
