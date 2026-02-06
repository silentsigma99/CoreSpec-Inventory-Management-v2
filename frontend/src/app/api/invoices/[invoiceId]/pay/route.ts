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

  // Read optional body (backwards compat: no body = full payment)
  let amount: number | null = null;
  let paymentMethod: string | null = null;
  let referenceNote: string | null = null;
  try {
    const body = await request.json();
    if (body.amount !== undefined && body.amount !== null) {
      amount = parseFloat(body.amount);
      if (isNaN(amount) || amount <= 0) {
        return NextResponse.json(
          { detail: "Amount must be a positive number" },
          { status: 400 }
        );
      }
    }
    paymentMethod = body.payment_method || null;
    referenceNote = body.reference_note || null;
  } catch {
    // No body sent - full payment (backwards compatible)
  }

  // Fetch invoice with current payment state
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, warehouse_id, status, total, amount_paid, balance_due")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .single();

  if (!invoice) {
    return NextResponse.json({ detail: "Invoice not found" }, { status: 404 });
  }

  const accessError = requireWarehouseAccess(user, invoice.warehouse_id);
  if (accessError) return accessError;

  if (invoice.status !== "CONFIRMED" && invoice.status !== "PARTIALLY_PAID") {
    return NextResponse.json(
      { detail: "Only CONFIRMED or PARTIALLY_PAID invoices can receive payments" },
      { status: 400 }
    );
  }

  // If no amount specified, pay the full remaining balance
  const paymentAmount = amount ?? parseFloat(invoice.balance_due);

  if (paymentAmount > parseFloat(invoice.balance_due) + 0.01) {
    return NextResponse.json(
      { detail: `Payment amount (${paymentAmount}) exceeds balance due (${invoice.balance_due})` },
      { status: 400 }
    );
  }

  const newAmountPaid = parseFloat(invoice.amount_paid) + paymentAmount;
  const newBalanceDue = parseFloat(invoice.total) - newAmountPaid;
  const isFullyPaid = newBalanceDue <= 0.005; // floating point tolerance

  // Insert payment record
  const { error: paymentError } = await supabase
    .from("payments")
    .insert({
      invoice_id: invoiceId,
      amount: paymentAmount,
      payment_method: paymentMethod,
      reference_note: referenceNote,
      recorded_by: user.userId,
    });

  if (paymentError) {
    return NextResponse.json(
      { detail: paymentError.message },
      { status: 500 }
    );
  }

  // Update invoice
  const updateData: Record<string, unknown> = {
    amount_paid: newAmountPaid,
    balance_due: Math.max(0, newBalanceDue),
    status: isFullyPaid ? "PAID" : "PARTIALLY_PAID",
  };

  if (isFullyPaid) {
    updateData.paid_at = new Date().toISOString();
  }

  const { data: updated, error: updateError } = await supabase
    .from("invoices")
    .update(updateData)
    .eq("id", invoiceId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ detail: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    invoice: updated,
    payment: {
      amount: paymentAmount,
      is_fully_paid: isFullyPaid,
      new_balance: Math.max(0, newBalanceDue),
    },
  });
}
