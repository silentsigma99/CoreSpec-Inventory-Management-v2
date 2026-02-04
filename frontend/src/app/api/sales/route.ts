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

  // Get inventory and validate stock
  const { data: inventory, error: inventoryError } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("warehouse_id", warehouse_id)
    .eq("product_id", product_id)
    .single();

  if (inventoryError || !inventory) {
    return NextResponse.json(
      { detail: "Product not found in this warehouse" },
      { status: 400 }
    );
  }

  const currentStock = inventory.quantity_on_hand;
  if (currentStock < quantity) {
    return NextResponse.json(
      {
        detail: `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`,
      },
      { status: 400 }
    );
  }

  try {
    // 1. Decrement inventory
    const newStock = currentStock - quantity;
    await supabase
      .from("inventory_items")
      .update({ quantity_on_hand: newStock })
      .eq("id", inventory.id);

    // 2. Create SALE transaction
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .insert({
        transaction_type: "SALE",
        product_id,
        from_warehouse_id: warehouse_id,
        to_warehouse_id: null,
        quantity,
        unit_price: finalUnitPrice,
        reference_note: reference_note || null,
        created_by: user.userId,
      })
      .select()
      .single();

    if (txError || !transaction) {
      throw new Error("Failed to create transaction");
    }

    return NextResponse.json({
      success: true,
      message: `Sale recorded: ${quantity} x ${product.name}`,
      transaction_id: transaction.id,
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
