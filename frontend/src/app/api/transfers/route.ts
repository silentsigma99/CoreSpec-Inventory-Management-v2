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

  // Get source inventory and validate stock
  const { data: sourceInventory, error: invError } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("warehouse_id", from_warehouse_id)
    .eq("product_id", product_id)
    .single();

  if (invError || !sourceInventory) {
    return NextResponse.json(
      { detail: "Product not found in source warehouse" },
      { status: 400 }
    );
  }

  const currentStock = sourceInventory.quantity_on_hand;
  if (currentStock < quantity) {
    return NextResponse.json(
      {
        detail: `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`,
      },
      { status: 400 }
    );
  }

  try {
    // 1. Decrement source inventory
    const newSourceQty = currentStock - quantity;
    await supabase
      .from("inventory_items")
      .update({ quantity_on_hand: newSourceQty })
      .eq("id", sourceInventory.id);

    // 2. Increment or create destination inventory
    const { data: destInventoryData } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("warehouse_id", to_warehouse_id)
      .eq("product_id", product_id);

    const destInventory = destInventoryData?.[0];

    if (destInventory) {
      // Update existing
      const newDestQty = destInventory.quantity_on_hand + quantity;
      await supabase
        .from("inventory_items")
        .update({ quantity_on_hand: newDestQty })
        .eq("id", destInventory.id);
    } else {
      // Create new inventory record
      await supabase.from("inventory_items").insert({
        warehouse_id: to_warehouse_id,
        product_id,
        quantity_on_hand: quantity,
      });
    }

    // 3. Create TRANSFER_OUT transaction
    const { data: transferOut, error: outError } = await supabase
      .from("transactions")
      .insert({
        transaction_type: "TRANSFER_OUT",
        product_id,
        from_warehouse_id,
        to_warehouse_id,
        quantity,
        reference_note: reference_note || `Transfer to ${dest.name}`,
        created_by: user.userId,
      })
      .select()
      .single();

    if (outError || !transferOut) {
      throw new Error("Failed to create TRANSFER_OUT transaction");
    }

    // 4. Create TRANSFER_IN transaction
    const { data: transferIn, error: inError } = await supabase
      .from("transactions")
      .insert({
        transaction_type: "TRANSFER_IN",
        product_id,
        from_warehouse_id,
        to_warehouse_id,
        quantity,
        reference_note: reference_note || `Transfer from ${source.name}`,
        created_by: user.userId,
      })
      .select()
      .single();

    if (inError || !transferIn) {
      throw new Error("Failed to create TRANSFER_IN transaction");
    }

    return NextResponse.json({
      success: true,
      message: `Successfully transferred ${quantity} units`,
      transfer_out_id: transferOut.id,
      transfer_in_id: transferIn.id,
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
