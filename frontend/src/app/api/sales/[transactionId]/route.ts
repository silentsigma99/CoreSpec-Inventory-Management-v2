import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireWarehouseAccess,
} from "@/lib/supabase-server";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> }
) {
  const { transactionId } = await params;

  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  if (user.role === "viewer") {
    return NextResponse.json(
      { detail: "Viewers cannot delete sales" },
      { status: 403 }
    );
  }

  const supabase = createServiceClient();

  // Fetch the transaction to validate
  const { data: transaction } = await supabase
    .from("transactions")
    .select("id, transaction_type, from_warehouse_id, invoice_id, deleted_at")
    .eq("id", transactionId)
    .single();

  if (!transaction) {
    return NextResponse.json(
      { detail: "Transaction not found" },
      { status: 404 }
    );
  }

  if (transaction.deleted_at) {
    return NextResponse.json(
      { detail: "Transaction already deleted" },
      { status: 400 }
    );
  }

  if (transaction.transaction_type !== "SALE") {
    return NextResponse.json(
      { detail: "Only SALE transactions can be deleted" },
      { status: 400 }
    );
  }

  if (transaction.invoice_id) {
    return NextResponse.json(
      { detail: "Cannot delete an invoiced sale. Void the invoice instead." },
      { status: 400 }
    );
  }

  // Check warehouse access
  const accessError = requireWarehouseAccess(user, transaction.from_warehouse_id);
  if (accessError) return accessError;

  const { error: rpcError } = await supabase.rpc("reverse_sale", {
    p_transaction_id: transactionId,
    p_user_id: user.userId,
  });

  if (rpcError) {
    return NextResponse.json(
      { detail: rpcError.message || "Failed to delete sale" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Sale deleted, stock restored",
  });
}
