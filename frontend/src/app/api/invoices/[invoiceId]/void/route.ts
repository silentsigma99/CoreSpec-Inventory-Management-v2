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

  const { error: rpcError } = await supabase.rpc("void_invoice", {
    p_invoice_id: invoiceId,
    p_user_id: user.userId,
  });

  if (rpcError) {
    return NextResponse.json(
      { detail: rpcError.message || "Failed to void invoice" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Invoice voided, stock restored",
  });
}
