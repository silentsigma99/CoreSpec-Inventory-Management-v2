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
  const { warehouse_id, product_id, quantity, unit_cost, reference_note } = body;

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
    // Check if inventory item exists
    const { data: inventoryData } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("warehouse_id", warehouse_id)
      .eq("product_id", product_id);

    let newStock: number;

    if (inventoryData && inventoryData.length > 0) {
      // Update existing inventory
      const currentStock = inventoryData[0].quantity_on_hand;
      newStock = currentStock + quantity;
      await supabase
        .from("inventory_items")
        .update({ quantity_on_hand: newStock })
        .eq("id", inventoryData[0].id);
    } else {
      // Create new inventory item
      newStock = quantity;
      await supabase.from("inventory_items").insert({
        warehouse_id,
        product_id,
        quantity_on_hand: newStock,
      });
    }

    // Create RESTOCK transaction
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .insert({
        transaction_type: "RESTOCK",
        product_id,
        from_warehouse_id: null,
        to_warehouse_id: warehouse_id,
        quantity,
        unit_price: finalUnitCost,
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
      message: `Purchase recorded: ${quantity} x ${product.name}`,
      transaction_id: transaction.id,
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
