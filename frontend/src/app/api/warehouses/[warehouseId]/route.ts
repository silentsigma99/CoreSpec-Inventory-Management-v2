import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireWarehouseAccess,
} from "@/lib/supabase-server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ warehouseId: string }> }
) {
  const { warehouseId } = await params;

  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  // Check access
  const accessError = requireWarehouseAccess(user, warehouseId);
  if (accessError) return accessError;

  const supabase = createServiceClient();

  const { data, error: dbError } = await supabase
    .from("warehouses")
    .select("*")
    .eq("id", warehouseId)
    .single();

  if (dbError || !data) {
    return NextResponse.json({ detail: "Warehouse not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: data.id,
    name: data.name,
    manager_id: data.manager_id || null,
    created_at: data.created_at || null,
  });
}
