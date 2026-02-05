import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireAdmin,
} from "@/lib/supabase-server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;

  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const adminError = requireAdmin(user);
  if (adminError) return adminError;

  const supabase = createServiceClient();

  const { data: batch, error: batchError } = await supabase
    .from("purchase_batches")
    .select("*")
    .eq("id", batchId)
    .single();

  if (batchError || !batch) {
    return NextResponse.json({ detail: "Batch not found" }, { status: 404 });
  }

  const { data: transactions } = await supabase
    .from("transactions")
    .select(`
      id,
      product_id,
      quantity,
      unit_price,
      reference_note,
      created_at,
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
    .eq("transaction_type", "RESTOCK")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });

  const items = (transactions || []).map((t: Record<string, unknown>) => ({
    id: t.id,
    product_id: t.product_id,
    quantity: t.quantity,
    unit_price: (t.unit_price as number) ?? 0,
    reference_note: (t.reference_note as string) ?? null,
    created_at: t.created_at,
    product: t.products ?? null,
  }));

  return NextResponse.json({
    ...batch,
    items,
  });
}
