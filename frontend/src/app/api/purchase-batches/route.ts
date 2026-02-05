import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireAdmin,
} from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const adminError = requireAdmin(user);
  if (adminError) return adminError;

  const supabase = createServiceClient();
  const searchParams = request.nextUrl.searchParams;
  const warehouseId = searchParams.get("warehouse_id");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = Math.min(parseInt(searchParams.get("page_size") || "20", 10), 100);

  if (!warehouseId) {
    return NextResponse.json(
      { detail: "warehouse_id is required" },
      { status: 400 }
    );
  }

  const query = supabase
    .from("purchase_batches")
    .select("id, po_number, vendor_bill_number, vendor_name, bill_date, total_amount, notes, warehouse_id, created_at", { count: "exact" })
    .eq("warehouse_id", warehouseId);

  const offset = (page - 1) * pageSize;
  const { data: batches, count: total, error: batchesError } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (batchesError) {
    return NextResponse.json({ detail: batchesError.message }, { status: 500 });
  }

  const batchIds = (batches || []).map((b) => b.id);
  const itemsByBatch: Record<string, { count: number; totalCost: number }> = {};

  if (batchIds.length > 0) {
    const { data: txData } = await supabase
      .from("transactions")
      .select("batch_id, quantity, unit_price")
      .eq("transaction_type", "RESTOCK")
      .in("batch_id", batchIds);

    for (const tx of txData || []) {
      if (tx.batch_id) {
        if (!itemsByBatch[tx.batch_id]) {
          itemsByBatch[tx.batch_id] = { count: 0, totalCost: 0 };
        }
        itemsByBatch[tx.batch_id].count += 1;
        itemsByBatch[tx.batch_id].totalCost += (tx.unit_price || 0) * tx.quantity;
      }
    }
  }

  const items = (batches || []).map((b) => ({
    id: b.id,
    po_number: b.po_number || null,
    vendor_bill_number: b.vendor_bill_number || null,
    vendor_name: b.vendor_name || null,
    bill_date: b.bill_date || null,
    total_amount: b.total_amount || null,
    notes: b.notes || null,
    warehouse_id: b.warehouse_id || null,
    created_at: b.created_at,
    item_count: itemsByBatch[b.id]?.count ?? 0,
    computed_total: itemsByBatch[b.id]?.totalCost ?? 0,
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

  const adminError = requireAdmin(user);
  if (adminError) return adminError;

  const body = await request.json();
  const {
    warehouse_id,
    po_number,
    vendor_bill_number,
    vendor_name,
    bill_date,
    total_amount,
    notes,
  } = body;

  if (!warehouse_id) {
    return NextResponse.json(
      { detail: "warehouse_id is required" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const { data: batch, error: insertError } = await supabase
    .from("purchase_batches")
    .insert({
      warehouse_id,
      po_number: po_number || null,
      vendor_bill_number: vendor_bill_number || null,
      vendor_name: vendor_name || null,
      bill_date: bill_date || null,
      total_amount: total_amount ?? null,
      notes: notes || null,
      created_by: user.userId,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json(
      { detail: insertError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    batch,
  });
}
