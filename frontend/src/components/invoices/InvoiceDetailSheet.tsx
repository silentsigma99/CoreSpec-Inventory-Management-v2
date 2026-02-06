"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface InvoiceDetailSheetProps {
  invoiceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "bg-zinc-500/20 text-zinc-400",
    CONFIRMED: "bg-blue-500/20 text-blue-400",
    PARTIALLY_PAID: "bg-amber-500/20 text-amber-400",
    PAID: "bg-green-500/20 text-green-400",
    CANCELLED: "bg-zinc-500/20 text-zinc-500 line-through",
    VOID: "bg-red-500/20 text-red-400",
  };
  return (
    <Badge variant="secondary" className={cn("text-xs", styles[status] || "")}>
      {status === "PARTIALLY_PAID" ? "PARTIAL" : status}
    </Badge>
  );
}

export function InvoiceDetailSheet({
  invoiceId,
  open,
  onOpenChange,
}: InvoiceDetailSheetProps) {
  const queryClient = useQueryClient();
  const [paymentInput, setPaymentInput] = useState("");

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => api.getInvoice(invoiceId!),
    enabled: !!invoiceId && open,
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.confirmInvoice(id),
    onSuccess: () => {
      toast.success("Invoice confirmed, stock reserved");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount?: number }) =>
      api.markInvoicePaid(id, amount ? { amount } : undefined),
    onSuccess: () => {
      toast.success("Payment recorded");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      setPaymentInput("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) => api.voidInvoice(id),
    onSuccess: () => {
      toast.success("Invoice voided, stock restored");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.cancelInvoice(id),
    onSuccess: () => {
      toast.success("Invoice cancelled");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const formatDate = (dateString: string | null) =>
    dateString
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(dateString))
      : "\u2014";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
      >
        <SheetHeader>
          <SheetTitle className="text-zinc-900 dark:text-white">
            {invoice ? (
              <span className="font-mono">{invoice.invoice_number}</span>
            ) : (
              "Invoice Details"
            )}
          </SheetTitle>
          <SheetDescription className="text-zinc-600 dark:text-zinc-400">
            {invoice ? (
              <StatusBadge status={invoice.status} />
            ) : (
              "Loading..."
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 py-4 space-y-6">
          {isLoading || !invoice ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Customer
                </h4>
                <p className="font-medium text-zinc-900 dark:text-white">
                  {invoice.customer_name}
                </p>
                {invoice.customer_phone && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {invoice.customer_phone}
                  </p>
                )}
                {invoice.customer_email && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {invoice.customer_email}
                  </p>
                )}
                {invoice.customer_address && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {invoice.customer_address}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-zinc-500 dark:text-zinc-400">Due Date</p>
                  <p className="font-medium text-zinc-900 dark:text-white">
                    {formatDate(invoice.due_date)}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 dark:text-zinc-400">Created</p>
                  <p className="font-medium text-zinc-900 dark:text-white">
                    {formatDate(invoice.created_at)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Items
                </h4>
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {(invoice.items || []).map((item: { id: string; product?: { name: string; sku: string }; quantity: number; unit_price: number; line_total: number }) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center p-3 text-sm"
                      >
                        <div>
                          <p className="font-medium text-zinc-900 dark:text-white">
                            {item.product?.name || "Unknown"}
                          </p>
                          <p className="text-xs text-zinc-500 font-mono">
                            {item.product?.sku}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-zinc-600 dark:text-zinc-400">
                            {item.quantity} × {formatCurrency(item.unit_price)}
                          </p>
                          <p className="font-medium text-zinc-900 dark:text-white">
                            {formatCurrency(item.line_total)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      Total
                    </span>
                    <span className="text-lg font-bold text-zinc-900 dark:text-white">
                      {formatCurrency(invoice.total)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment Summary */}
              {(invoice.status === "CONFIRMED" || invoice.status === "PARTIALLY_PAID" || invoice.status === "PAID") && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Payment Summary
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg p-3">
                    <div>
                      <p className="text-zinc-500 dark:text-zinc-400">Amount Paid</p>
                      <p className="font-medium text-green-600 dark:text-green-400">
                        {formatCurrency(invoice.amount_paid)}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500 dark:text-zinc-400">Balance Due</p>
                      <p className={cn("font-medium", invoice.balance_due > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400")}>
                        {formatCurrency(invoice.balance_due)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Payment History */}
              {invoice.payments && invoice.payments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Payment History
                  </h4>
                  <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden divide-y divide-zinc-200 dark:divide-zinc-700">
                    {invoice.payments.map((payment: { id: string; amount: number; payment_method?: string; reference_note?: string; created_at: string }) => (
                      <div key={payment.id} className="p-3 flex justify-between items-center text-sm">
                        <div>
                          <p className="text-zinc-600 dark:text-zinc-400">{formatDate(payment.created_at)}</p>
                          {payment.payment_method && (
                            <p className="text-xs text-zinc-500 capitalize">{payment.payment_method}</p>
                          )}
                          {payment.reference_note && (
                            <p className="text-xs text-zinc-500">{payment.reference_note}</p>
                          )}
                        </div>
                        <p className="font-medium text-green-600 dark:text-green-400">
                          {formatCurrency(payment.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {invoice.notes && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Notes
                  </p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {invoice.notes}
                  </p>
                </div>
              )}

              {/* Actions */}
              {(invoice.status === "DRAFT" ||
                invoice.status === "CONFIRMED" ||
                invoice.status === "PARTIALLY_PAID") && (
                <div className="flex flex-col gap-2 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                  {invoice.status === "DRAFT" && (
                    <Button
                      onClick={() => confirmMutation.mutate(invoice.id)}
                      disabled={confirmMutation.isPending}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {confirmMutation.isPending
                        ? "Confirming..."
                        : "Confirm Invoice (Reserve Stock)"}
                    </Button>
                  )}
                  {(invoice.status === "CONFIRMED" || invoice.status === "PARTIALLY_PAID") && (
                    <>
                      <div className="space-y-2">
                        <Input
                          type="number"
                          min={0}
                          max={invoice.balance_due}
                          step={0.01}
                          value={paymentInput}
                          onChange={(e) => setPaymentInput(e.target.value)}
                          placeholder={`Amount (max ${formatCurrency(invoice.balance_due)})`}
                          className="bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                        />
                        <Button
                          onClick={() => {
                            const amt = parseFloat(paymentInput);
                            if (paymentInput && !isNaN(amt) && amt > 0) {
                              payMutation.mutate({ id: invoice.id, amount: amt });
                            } else {
                              payMutation.mutate({ id: invoice.id });
                            }
                          }}
                          disabled={payMutation.isPending}
                          className="w-full bg-green-600 hover:bg-green-700 text-white"
                        >
                          {payMutation.isPending
                            ? "Processing..."
                            : paymentInput && parseFloat(paymentInput) > 0
                              ? `Pay ${formatCurrency(parseFloat(paymentInput))}`
                              : `Pay Full Balance (${formatCurrency(invoice.balance_due)})`}
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => voidMutation.mutate(invoice.id)}
                        disabled={voidMutation.isPending}
                        className="w-full border-red-500/50 text-red-600 hover:bg-red-500/10"
                      >
                        {voidMutation.isPending
                          ? "Processing..."
                          : "Void Invoice (Restore Stock)"}
                      </Button>
                      {invoice.status === "PARTIALLY_PAID" && (
                        <Button
                          variant="outline"
                          onClick={() => cancelMutation.mutate(invoice.id)}
                          disabled={cancelMutation.isPending}
                          className="w-full border-zinc-500/50 text-zinc-500 hover:bg-zinc-500/10"
                        >
                          {cancelMutation.isPending
                            ? "Processing..."
                            : "Cancel Invoice (Write Off)"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
