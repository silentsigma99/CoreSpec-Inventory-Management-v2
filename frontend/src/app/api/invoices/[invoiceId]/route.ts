import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireWarehouseAccess,
} from "@/lib/supabase-server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;

  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .single();

  if (invoiceError || !invoice) {
    return NextResponse.json({ detail: "Invoice not found" }, { status: 404 });
  }

  const accessError = requireWarehouseAccess(user, invoice.warehouse_id);
  if (accessError) return accessError;

  const { data: invoiceItems } = await supabase
    .from("invoice_items")
    .select(`
      id,
      product_id,
      quantity,
      unit_price,
      line_total,
      products (
        id,
        sku,
        name,
        brand,
        retail_price,
        wholesale_price,
        cost_price
      )
    `)
    .eq("invoice_id", invoiceId);

  const items = (invoiceItems || []).map((item: { products?: object }) => ({
    ...item,
    product: item.products ?? null,
  }));

  return NextResponse.json({
    ...invoice,
    items,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;

  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from("invoices")
    .select("id, warehouse_id, status")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .single();

  if (!existing) {
    return NextResponse.json({ detail: "Invoice not found" }, { status: 404 });
  }

  const accessError = requireWarehouseAccess(user, existing.warehouse_id);
  if (accessError) return accessError;

  if (existing.status !== "DRAFT") {
    return NextResponse.json(
      { detail: "Only DRAFT invoices can be updated" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const allowed = [
    "customer_name",
    "customer_phone",
    "customer_address",
    "customer_email",
    "due_date",
    "notes",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ detail: "No valid fields to update" }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("invoices")
    .update(updates)
    .eq("id", invoiceId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ detail: updateError.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
