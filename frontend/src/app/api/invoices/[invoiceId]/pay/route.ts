import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireWarehouseAccess,
} from "@/lib/supabase-server";

export async function POST(
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

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, warehouse_id, status")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .single();

  if (!invoice) {
    return NextResponse.json({ detail: "Invoice not found" }, { status: 404 });
  }

  const accessError = requireWarehouseAccess(user, invoice.warehouse_id);
  if (accessError) return accessError;

  if (invoice.status !== "CONFIRMED") {
    return NextResponse.json(
      { detail: "Only CONFIRMED invoices can be marked as paid" },
      { status: 400 }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("invoices")
    .update({ status: "PAID", paid_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ detail: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    invoice: updated,
  });
}
