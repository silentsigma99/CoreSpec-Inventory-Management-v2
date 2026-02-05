import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireWarehouseAccess,
} from "@/lib/supabase-server";

interface SaleRequest {
  warehouse_id: string;
  product_id: string;
  quantity: number;
  unit_price?: number;
  reference_note?: string;
}

export async function POST(request: NextRequest) {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const body: SaleRequest = await request.json();
  const { warehouse_id, product_id, quantity, unit_price, reference_note } = body;

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

  // Check warehouse access
  const accessError = requireWarehouseAccess(user, warehouse_id);
  if (accessError) return accessError;

  const supabase = createServiceClient();

  // Validate warehouse exists
  const { data: warehouse, error: warehouseError } = await supabase
    .from("warehouses")
    .select("id, name")
    .eq("id", warehouse_id)
    .single();

  if (warehouseError || !warehouse) {
    return NextResponse.json({ detail: "Warehouse not found" }, { status: 404 });
  }

  // Validate product exists and fetch pricing info
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, name, retail_price, cost_price")
    .eq("id", product_id)
    .single();

  if (productError || !product) {
    return NextResponse.json({ detail: "Product not found" }, { status: 404 });
  }

  // Determine final sale price
  const finalUnitPrice = unit_price ?? product.retail_price;

  // Validate price against cost (margin protection)
  if (finalUnitPrice != null && product.cost_price != null) {
    if (finalUnitPrice < product.cost_price) {
      return NextResponse.json(
        {
          detail: `Sale price ($${finalUnitPrice.toFixed(2)}) cannot be below cost ($${product.cost_price.toFixed(2)})`,
        },
        { status: 400 }
      );
    }
  }

  // Get current stock for response (validation happens in RPC)
  const { data: inventory } = await supabase
    .from("inventory_items")
    .select("quantity_on_hand")
    .eq("warehouse_id", warehouse_id)
    .eq("product_id", product_id)
    .single();

  const currentStock = inventory?.quantity_on_hand ?? 0;
  if (currentStock < quantity) {
    return NextResponse.json(
      {
        detail: `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`,
      },
      { status: 400 }
    );
  }

  try {
    const { data: transactionId, error: rpcError } = await supabase.rpc(
      "record_sale",
      {
        p_warehouse_id: warehouse_id,
        p_product_id: product_id,
        p_quantity: quantity,
        p_unit_price: finalUnitPrice,
        p_note: reference_note || null,
        p_user_id: user.userId,
      }
    );

    if (rpcError || !transactionId) {
      const errMsg = rpcError?.message ?? "Failed to record sale";
      return NextResponse.json(
        { detail: errMsg },
        { status: 400 }
      );
    }

    const newStock = currentStock - quantity;
    return NextResponse.json({
      success: true,
      message: `Sale recorded: ${quantity} x ${product.name}`,
      transaction_id: transactionId,
      warehouse_id,
      product_id,
      quantity,
      unit_price: finalUnitPrice,
      new_stock_level: newStock,
    });
  } catch (err) {
    console.error("Sale error:", err);
    return NextResponse.json(
      { detail: `Failed to record sale: ${err}` },
      { status: 500 }
    );
  }
}
