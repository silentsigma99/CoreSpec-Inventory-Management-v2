import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireAdmin,
} from "@/lib/supabase-server";

interface TransferRequest {
  from_warehouse_id: string;
  to_warehouse_id: string;
  product_id: string;
  quantity: number;
  reference_note?: string;
}

export async function POST(request: NextRequest) {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  // Only admins can transfer
  const adminError = requireAdmin(user);
  if (adminError) return adminError;

  const body: TransferRequest = await request.json();
  const { from_warehouse_id, to_warehouse_id, product_id, quantity, reference_note } =
    body;

  // Validate required fields
  if (!from_warehouse_id || !to_warehouse_id || !product_id || !quantity) {
    return NextResponse.json(
      {
        detail:
          "from_warehouse_id, to_warehouse_id, product_id, and quantity are required",
      },
      { status: 400 }
    );
  }

  if (quantity <= 0) {
    return NextResponse.json(
      { detail: "Quantity must be greater than 0" },
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

  // Validate product exists
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, name")
    .eq("id", product_id)
    .single();

  if (productError || !product) {
    return NextResponse.json({ detail: "Product not found" }, { status: 404 });
  }

  // Pre-validate stock (RPC will re-validate atomically)
  const { data: sourceInventory } = await supabase
    .from("inventory_items")
    .select("quantity_on_hand")
    .eq("warehouse_id", from_warehouse_id)
    .eq("product_id", product_id)
    .single();

  const currentStock = sourceInventory?.quantity_on_hand ?? 0;
  if (currentStock < quantity) {
    return NextResponse.json(
      {
        detail: `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`,
      },
      { status: 400 }
    );
  }

  const note = reference_note || `Transfer to ${dest.name}`;

  try {
    const { data: result, error: rpcError } = await supabase.rpc("record_transfer", {
      p_from_warehouse_id: from_warehouse_id,
      p_to_warehouse_id: to_warehouse_id,
      p_product_id: product_id,
      p_quantity: quantity,
      p_note: note,
      p_user_id: user.userId,
    });

    if (rpcError || !result || result.length === 0) {
      const errMsg = rpcError?.message ?? "Transfer failed";
      return NextResponse.json({ detail: errMsg }, { status: 400 });
    }

    const row = Array.isArray(result) ? result[0] : result;
    return NextResponse.json({
      success: true,
      message: `Successfully transferred ${quantity} units`,
      transfer_out_id: row.transfer_out_id,
      transfer_in_id: row.transfer_in_id,
      from_warehouse_id,
      to_warehouse_id,
      product_id,
      quantity,
    });
  } catch (err) {
    console.error("Transfer error:", err);
    return NextResponse.json(
      { detail: `Transfer failed: ${err}` },
      { status: 500 }
    );
  }
}
