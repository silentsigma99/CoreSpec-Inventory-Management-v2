import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireAdmin,
} from "@/lib/supabase-server";

interface BulkTransferItem {
  product_id: string;
  quantity: number;
}

interface BulkTransferRequest {
  from_warehouse_id: string;
  to_warehouse_id: string;
  items: BulkTransferItem[];
  reference_note?: string;
}

const MAX_BATCH_SIZE = 100;

export async function POST(request: NextRequest) {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const adminError = requireAdmin(user);
  if (adminError) return adminError;

  let body: BulkTransferRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { detail: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { from_warehouse_id, to_warehouse_id, items, reference_note } = body;

  if (!from_warehouse_id || !to_warehouse_id || !items || !Array.isArray(items)) {
    return NextResponse.json(
      {
        detail:
          "from_warehouse_id, to_warehouse_id, and items (array) are required",
      },
      { status: 400 }
    );
  }

  if (from_warehouse_id === to_warehouse_id) {
    return NextResponse.json(
      { detail: "Source and destination warehouse cannot be the same" },
      { status: 400 }
    );
  }

  // Filter valid items and check batch size
  const validItems = items.filter(
    (item) =>
      item &&
      typeof item.product_id === "string" &&
      item.product_id &&
      typeof item.quantity === "number" &&
      item.quantity > 0
  );

  if (validItems.length === 0) {
    return NextResponse.json(
      { detail: "No valid items to transfer" },
      { status: 400 }
    );
  }

  if (validItems.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      {
        detail: `Batch size exceeds limit of ${MAX_BATCH_SIZE} items. Got ${validItems.length} items.`,
      },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Validate warehouses exist
  const { data: source, error: sourceError } = await supabase
    .from("warehouses")
    .select("id, name")
    .eq("id", from_warehouse_id)
    .single();

  if (sourceError || !source) {
    return NextResponse.json(
      { detail: "Source warehouse not found" },
      { status: 404 }
    );
  }

  const { data: dest, error: destError } = await supabase
    .from("warehouses")
    .select("id, name")
    .eq("id", to_warehouse_id)
    .single();

  if (destError || !dest) {
    return NextResponse.json(
      { detail: "Destination warehouse not found" },
      { status: 404 }
    );
  }

  const note = reference_note || `Bulk transfer to ${dest.name}`;

  try {
    const { data: result, error: rpcError } = await supabase.rpc(
      "record_bulk_transfer",
      {
        p_from_warehouse_id: from_warehouse_id,
        p_to_warehouse_id: to_warehouse_id,
        p_items: validItems,
        p_note: note,
        p_user_id: user.userId,
      }
    );

    if (rpcError) {
      return NextResponse.json(
        { detail: rpcError.message || "Bulk transfer failed" },
        { status: 400 }
      );
    }

    const rows = Array.isArray(result) ? result : [result];
    const succeeded = rows.filter((r) => r.success);
    const failed = rows.filter((r) => !r.success);

    const response = {
      success: succeeded.length > 0,
      total: rows.length,
      succeeded: succeeded.length,
      failed: failed.length,
      results: rows.map((r) => ({
        product_id: r.product_id,
        success: r.success,
        error: r.error_message || undefined,
        transfer_out_id: r.transfer_out_id || undefined,
        transfer_in_id: r.transfer_in_id || undefined,
      })),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("Bulk transfer error:", err);
    return NextResponse.json(
      { detail: `Bulk transfer failed: ${err}` },
      { status: 500 }
    );
  }
}
