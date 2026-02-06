import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireWarehouseAccess,
} from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const searchParams = request.nextUrl.searchParams;
  const warehouseId = searchParams.get("warehouse_id");
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = Math.min(parseInt(searchParams.get("page_size") || "20", 10), 100);

  if (!warehouseId) {
    return NextResponse.json(
      { detail: "warehouse_id is required" },
      { status: 400 }
    );
  }

  const accessError = requireWarehouseAccess(user, warehouseId);
  if (accessError) return accessError;

  let query = supabase
    .from("invoices")
    .select("id, invoice_number, warehouse_id, customer_name, status, total, amount_paid, balance_due, due_date, created_at, confirmed_at, paid_at", { count: "exact" })
    .eq("warehouse_id", warehouseId)
    .is("deleted_at", null);

  if (status) {
    query = query.eq("status", status);
  }

  const offset = (page - 1) * pageSize;
  const { data: invoices, count: total, error: listError } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (listError) {
    console.error("[GET /api/invoices] Supabase error:", listError);
    return NextResponse.json({ detail: listError.message }, { status: 500 });
  }

  const batchIds = (invoices || []).map((i) => i.id);
  const itemCounts: Record<string, number> = {};

  if (batchIds.length > 0) {
    const { data: items } = await supabase
      .from("invoice_items")
      .select("invoice_id")
      .in("invoice_id", batchIds);

    for (const item of items || []) {
      itemCounts[item.invoice_id] = (itemCounts[item.invoice_id] || 0) + 1;
    }
  }

  const items = (invoices || []).map((inv) => ({
    ...inv,
    item_count: itemCounts[inv.id] ?? 0,
  }));

  return NextResponse.json({
    items,
    total: total ?? 0,
    page,
    page_size: pageSize,
  });
}

export async function POST(request: NextRequest) {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    warehouse_id,
    customer_name,
    customer_phone,
    customer_address,
    customer_email,
    due_date,
    notes,
    items,
  } = body;

  if (!warehouse_id || !customer_name || !items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { detail: "warehouse_id, customer_name, and items (non-empty array) are required" },
      { status: 400 }
    );
  }

  const accessError = requireWarehouseAccess(user, warehouse_id);
  if (accessError) return accessError;

  const supabase = createServiceClient();

  let subtotal = 0;
  const validItems: { product_id: string; quantity: number; unit_price: number; line_total: number }[] = [];

  for (const item of items) {
    const productId = item.product_id;
    const quantity = parseInt(item.quantity, 10);
    const unitPrice = parseFloat(item.unit_price);

    if (!productId || isNaN(quantity) || quantity <= 0 || isNaN(unitPrice) || unitPrice < 0) {
      continue;
    }

    const lineTotal = quantity * unitPrice;
    subtotal += lineTotal;
    validItems.push({ product_id: productId, quantity, unit_price: unitPrice, line_total: lineTotal });
  }

  if (validItems.length === 0) {
    return NextResponse.json(
      { detail: "At least one valid item is required" },
      { status: 400 }
    );
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      warehouse_id,
      customer_name: customer_name.trim(),
      customer_phone: customer_phone?.trim() || null,
      customer_address: customer_address?.trim() || null,
      customer_email: customer_email?.trim() || null,
      due_date: due_date || null,
      notes: notes?.trim() || null,
      subtotal,
      discount: 0,
      total: subtotal,
      status: "DRAFT",
      created_by: user.userId,
    })
    .select()
    .single();

  if (invoiceError || !invoice) {
    return NextResponse.json(
      { detail: invoiceError?.message || "Failed to create invoice" },
      { status: 500 }
    );
  }

  const itemsToInsert = validItems.map((item) => ({
    invoice_id: invoice.id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.line_total,
  }));

  const { error: itemsError } = await supabase
    .from("invoice_items")
    .insert(itemsToInsert);

  if (itemsError) {
    await supabase.from("invoices").delete().eq("id", invoice.id);
    return NextResponse.json(
      { detail: itemsError.message || "Failed to add invoice items" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    invoice,
  });
}
