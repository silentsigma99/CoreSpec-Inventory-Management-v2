import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireAdmin,
} from "@/lib/supabase-server";

interface PurchaseRequest {
  warehouse_id: string;
  product_id: string;
  quantity: number;
  unit_cost?: number;
  reference_note?: string;
  batch_id?: string;
}

export async function POST(request: NextRequest) {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  // Only admins can record purchases
  const adminError = requireAdmin(user);
  if (adminError) return adminError;

  const body: PurchaseRequest = await request.json();
  const { warehouse_id, product_id, quantity, unit_cost, reference_note, batch_id } = body;

  // Validate required fields
  if (!warehouse_id || !product_id || !quantity) {
    return NextResponse.json(
      { detail: "warehouse_id, product_id, and quantity are required" },
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

  // Validate warehouse exists
  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("id, name")
    .eq("id", warehouse_id);

  if (!warehouses || warehouses.length === 0) {
    return NextResponse.json({ detail: "Warehouse not found" }, { status: 404 });
  }

  // Validate product exists and fetch cost info
  const { data: products } = await supabase
    .from("products")
    .select("id, name, cost_price")
    .eq("id", product_id);

  if (!products || products.length === 0) {
    return NextResponse.json({ detail: "Product not found" }, { status: 404 });
  }

  const product = products[0];

  // Determine final cost
  const finalUnitCost = unit_cost ?? product.cost_price;

  try {
    const { data: transactionId, error: rpcError } = await supabase.rpc(
      "record_purchase",
      {
        p_warehouse_id: warehouse_id,
        p_product_id: product_id,
        p_quantity: quantity,
        p_unit_cost: finalUnitCost,
        p_note: reference_note || null,
        p_user_id: user.userId,
        p_batch_id: batch_id || null,
      }
    );

    if (rpcError || !transactionId) {
      const errMsg = rpcError?.message ?? "Failed to record purchase";
      return NextResponse.json({ detail: errMsg }, { status: 400 });
    }

    const { data: inventoryData } = await supabase
      .from("inventory_items")
      .select("quantity_on_hand")
      .eq("warehouse_id", warehouse_id)
      .eq("product_id", product_id)
      .single();

    const newStock = inventoryData?.quantity_on_hand ?? quantity;

    return NextResponse.json({
      success: true,
      message: `Purchase recorded: ${quantity} x ${product.name}`,
      transaction_id: transactionId,
      warehouse_id,
      product_id,
      quantity,
      unit_cost: finalUnitCost,
      new_stock_level: newStock,
    });
  } catch (err) {
    console.error("Purchase error:", err);
    return NextResponse.json(
      { detail: `Failed to record purchase: ${err}` },
      { status: 500 }
    );
  }
}
