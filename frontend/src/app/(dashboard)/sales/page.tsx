"use client";

/**
 * Sales History Page
 *
 * Two tabs:
 * - On-the-Spot Sales: Individual SALE transactions (recorded from Inventory)
 * - Invoiced Sales: Invoices with DRAFT/CONFIRMED/PAID status
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandFilter } from "@/components/ui/brand-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { InvoiceDetailSheet } from "@/components/invoices/InvoiceDetailSheet";

interface Warehouse {
  id: string;
  name: string;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  retail_price?: number;
}

interface Transaction {
  id: string;
  transaction_type: string;
  product_id: string;
  quantity: number;
  unit_price?: number;
  reference_note?: string;
  created_at: string;
  product?: Product;
  from_warehouse?: { id: string; name: string };
}

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  status: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  due_date: string | null;
  created_at: string;
  item_count: number;
}

function InvoiceStatusBadge({ status }: { status: string }) {
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

export default function SalesHistoryPage() {
  const { profile, isAdmin, isViewer } = useAuth();
  const queryClient = useQueryClient();
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"spot" | "invoiced">("spot");
  const [spotPage, setSpotPage] = useState(1);
  const [invoicePage, setInvoicePage] = useState(1);
  const [brand, setBrand] = useState<string>("all");
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState(false);
  const [paymentDialogInvoice, setPaymentDialogInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const pageSize = 20;

  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () => api.getWarehouses(),
    enabled: isAdmin || isViewer,
  });

  useEffect(() => {
    if (profile?.warehouse_id && !selectedWarehouse) {
      setSelectedWarehouse(profile.warehouse_id);
    } else if ((isAdmin || isViewer) && warehouses?.length && !selectedWarehouse) {
      setSelectedWarehouse(warehouses[0].id);
    }
  }, [profile, isAdmin, isViewer, warehouses, selectedWarehouse]);

  useEffect(() => {
    setSpotPage(1);
    setInvoicePage(1);
  }, [selectedWarehouse, brand]);

  const { data: transactions, isLoading: spotLoading, error: spotError } = useQuery<{
    items: Transaction[];
    total: number;
    page: number;
    page_size: number;
  }>({
    queryKey: ["transactions", selectedWarehouse, "SALE", true, spotPage, brand],
    queryFn: () =>
      api.getTransactions(selectedWarehouse, {
        transaction_type: "SALE",
        exclude_invoiced: true,
        page: spotPage,
        page_size: pageSize,
        brand: brand === "all" ? undefined : brand,
      }),
    enabled: !!selectedWarehouse && activeTab === "spot",
  });

  const { data: invoicesData, isLoading: invoiceLoading, error: invoiceError } = useQuery<{
    items: Invoice[];
    total: number;
    page: number;
    page_size: number;
  }>({
    queryKey: ["invoices", selectedWarehouse, invoicePage],
    queryFn: () =>
      api.getInvoices(selectedWarehouse, {
        page: invoicePage,
        page_size: pageSize,
      }),
    enabled: !!selectedWarehouse && activeTab === "invoiced",
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.confirmInvoice(id),
    onSuccess: () => {
      toast.success("Invoice confirmed, stock reserved");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount?: number }) =>
      api.markInvoicePaid(id, amount ? { amount } : undefined),
    onSuccess: (_data, variables) => {
      toast.success(variables.amount ? `Payment of ${formatCurrency(variables.amount)} recorded` : "Invoice marked as paid");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) => api.voidInvoice(id),
    onSuccess: () => {
      toast.success("Invoice voided, stock restored");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const formatDate = (dateString: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(dateString));

  const spotTotalPages = transactions ? Math.ceil(transactions.total / pageSize) : 0;
  const invoiceTotalPages = invoicesData ? Math.ceil(invoicesData.total / pageSize) : 0;
  const pageRevenue =
    transactions?.items.reduce((sum, t) => sum + (t.unit_price || 0) * t.quantity, 0) ?? 0;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };
  const itemVariants = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Sales</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            On-the-spot sales and invoiced sales
          </p>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          <BrandFilter value={brand} onChange={setBrand} />
          {(isAdmin || isViewer) && warehouses && (
            <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
              <SelectTrigger className="w-full sm:w-[200px] border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white">
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((wh) => (
                  <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div variants={itemVariants} className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setActiveTab("spot")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "spot"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          )}
        >
          On-the-Spot Sales
        </button>
        <button
          onClick={() => setActiveTab("invoiced")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "invoiced"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          )}
        >
          Invoiced Sales
        </button>
      </motion.div>

      {activeTab === "spot" && (
        <>
          <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Total Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-900 dark:text-white">
                  {spotLoading ? <Skeleton className="h-8 w-16" /> : transactions?.total ?? 0}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Page Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {spotLoading ? <Skeleton className="h-8 w-20" /> : formatCurrency(pageRevenue)}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B] col-span-2 md:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Showing</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-medium text-zinc-900 dark:text-white">
                  {spotLoading ? <Skeleton className="h-6 w-24" /> : transactions?.items.length ? `${(spotPage - 1) * pageSize + 1}-${Math.min(spotPage * pageSize, transactions.total)} of ${transactions.total}` : "No sales"}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants} className="hidden md:block">
            <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 p-6 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-200 dark:border-zinc-800">
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Date</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Location</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Product</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Qty</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Unit Price</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Total</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spotLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i} className="border-zinc-200 dark:border-zinc-800">
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      </TableRow>
                    ))
                  ) : spotError ? (
                    <TableRow className="border-zinc-200 dark:border-zinc-800">
                      <TableCell colSpan={7} className="text-center text-red-500 dark:text-red-400 py-8">
                        Error loading sales: {spotError.message}
                      </TableCell>
                    </TableRow>
                  ) : transactions?.items.length === 0 ? (
                    <TableRow className="border-zinc-200 dark:border-zinc-800">
                      <TableCell colSpan={7} className="text-center text-zinc-500 py-8">
                        No on-the-spot sales yet. Go to Inventory to record a sale.
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions?.items.map((t) => {
                      const total = (t.unit_price || 0) * t.quantity;
                      return (
                        <TableRow key={t.id} className="border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50">
                          <TableCell className="text-zinc-600 dark:text-zinc-400 text-sm">{formatDate(t.created_at)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">
                              {t.from_warehouse?.name || "—"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-zinc-900 dark:text-white">{t.product?.name || "Unknown"}</p>
                            <p className="text-xs text-zinc-500">{t.product?.sku}</p>
                          </TableCell>
                          <TableCell className="text-right"><Badge variant="secondary">{t.quantity}</Badge></TableCell>
                          <TableCell className="text-right text-zinc-600 dark:text-zinc-400">{formatCurrency(t.unit_price)}</TableCell>
                          <TableCell className="text-right font-medium text-zinc-900 dark:text-white">{formatCurrency(total)}</TableCell>
                          <TableCell className="text-zinc-500 dark:text-zinc-400 text-sm max-w-[150px] truncate">{t.reference_note || "—"}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              {spotTotalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Page {spotPage} of {spotTotalPages}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSpotPage((p) => Math.max(1, p - 1))} disabled={spotPage === 1} className="border-zinc-300 dark:border-zinc-700">
                      <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSpotPage((p) => Math.min(spotTotalPages, p + 1))} disabled={spotPage === spotTotalPages} className="border-zinc-300 dark:border-zinc-700">
                      Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </motion.div>

          <motion.div variants={itemVariants} className="md:hidden space-y-3">
            {spotLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card key={i} className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <CardContent className="p-4">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-4 w-48 mb-3" />
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-6 w-16" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : spotError ? (
              <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
                <CardContent className="p-8 text-center text-red-500 dark:text-red-400">Error loading sales: {spotError.message}</CardContent>
              </Card>
            ) : transactions?.items.length === 0 ? (
              <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
                <CardContent className="p-8 text-center text-zinc-500">No on-the-spot sales yet.</CardContent>
              </Card>
            ) : (
              transactions?.items.map((t) => {
                const total = (t.unit_price || 0) * t.quantity;
                return (
                  <Card key={t.id} className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium text-zinc-900 dark:text-white">{t.product?.name || "Unknown"}</p>
                          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t.product?.sku}</p>
                        </div>
                        <p className="font-bold text-lg text-green-600 dark:text-green-400">{formatCurrency(total)}</p>
                      </div>
                      <div className="flex justify-between items-center text-sm flex-wrap gap-2">
                        <span className="text-zinc-500 dark:text-zinc-400">{formatDate(t.created_at)}</span>
                        <div className="flex items-center gap-2">
                          {t.from_warehouse?.name && (
                            <Badge variant="secondary" className="text-xs">
                              {t.from_warehouse.name}
                            </Badge>
                          )}
                          <span className="text-zinc-600 dark:text-zinc-400">{t.quantity} × {formatCurrency(t.unit_price)}</span>
                        </div>
                      </div>
                      {t.reference_note && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-700 pt-2 mt-2 truncate">{t.reference_note}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
            {spotTotalPages > 1 && transactions && transactions.items.length > 0 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Page {spotPage} of {spotTotalPages}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSpotPage((p) => Math.max(1, p - 1))} disabled={spotPage === 1} className="border-zinc-300 dark:border-zinc-700"><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setSpotPage((p) => Math.min(spotTotalPages, p + 1))} disabled={spotPage === spotTotalPages} className="border-zinc-300 dark:border-zinc-700"><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}

      {activeTab === "invoiced" && (
        <>
          <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {invoiceLoading ? "Loading..." : `${invoicesData?.total ?? 0} invoices`}
            </p>
            {!isViewer && (
              <Button
                onClick={() => setShowInvoiceForm(true)}
                disabled={!selectedWarehouse}
                title={!selectedWarehouse ? "Select a warehouse first" : undefined}
                className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Invoice
              </Button>
            )}
          </motion.div>

          <motion.div variants={itemVariants} className="hidden md:block">
            <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 p-6 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-200 dark:border-zinc-800">
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Invoice #</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Customer</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Items</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Total</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Status</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Due Date</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Created</TableHead>
                    <TableHead className="text-zinc-600 dark:text-zinc-400">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoiceLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i} className="border-zinc-200 dark:border-zinc-800">
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      </TableRow>
                    ))
                  ) : invoiceError ? (
                    <TableRow className="border-zinc-200 dark:border-zinc-800">
                      <TableCell colSpan={8} className="text-center text-red-500 dark:text-red-400 py-12">
                        Error loading invoices: {invoiceError.message}
                      </TableCell>
                    </TableRow>
                  ) : !selectedWarehouse ? (
                    <TableRow className="border-zinc-200 dark:border-zinc-800">
                      <TableCell colSpan={8} className="text-center text-zinc-500 py-12">
                        Select a warehouse to view invoices.
                      </TableCell>
                    </TableRow>
                  ) : (invoicesData?.items ?? []).length === 0 ? (
                    <TableRow className="border-zinc-200 dark:border-zinc-800">
                      <TableCell colSpan={8} className="text-center text-zinc-500 py-12">
                        No invoices yet. Click &quot;Create Invoice&quot; to add one.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (invoicesData?.items ?? []).map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50 cursor-pointer"
                        onClick={() => {
                          setSelectedInvoiceId(inv.id);
                          setInvoiceDetailOpen(true);
                        }}
                      >
                        <TableCell className="font-mono text-sm text-zinc-700 dark:text-zinc-300">{inv.invoice_number}</TableCell>
                        <TableCell className="font-medium text-zinc-900 dark:text-white">{inv.customer_name}</TableCell>
                        <TableCell><Badge variant="secondary">{inv.item_count}</Badge></TableCell>
                        <TableCell className="text-right">
                          <span className="font-medium text-green-600 dark:text-green-400">{formatCurrency(inv.total)}</span>
                          {inv.status === "PARTIALLY_PAID" && (
                            <p className="text-xs text-amber-500 mt-0.5">
                              Paid: {formatCurrency(inv.amount_paid)} | Due: {formatCurrency(inv.balance_due)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell><InvoiceStatusBadge status={inv.status} /></TableCell>
                        <TableCell className="text-zinc-600 dark:text-zinc-400 text-sm">{inv.due_date ? formatDate(inv.due_date) : "—"}</TableCell>
                        <TableCell className="text-zinc-600 dark:text-zinc-400 text-sm">{formatDate(inv.created_at)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1 flex-wrap">
                            {!isViewer && inv.status === "DRAFT" && (
                              <Button size="sm" variant="outline" onClick={() => confirmMutation.mutate(inv.id)} disabled={confirmMutation.isPending} className="text-xs">
                                Confirm
                              </Button>
                            )}
                            {!isViewer && (inv.status === "CONFIRMED" || inv.status === "PARTIALLY_PAID") && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => { setPaymentDialogInvoice(inv); setPaymentAmount(""); }} disabled={payMutation.isPending} className="text-xs">
                                  {inv.status === "PARTIALLY_PAID" ? "Record Payment" : "Mark Paid"}
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => voidMutation.mutate(inv.id)} disabled={voidMutation.isPending} className="text-xs text-red-600">
                                  Void
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => { setSelectedInvoiceId(inv.id); setInvoiceDetailOpen(true); }} className="text-xs">
                              View
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {invoiceTotalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Page {invoicePage} of {invoiceTotalPages}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setInvoicePage((p) => Math.max(1, p - 1))} disabled={invoicePage === 1} className="border-zinc-300 dark:border-zinc-700"><ChevronLeft className="h-4 w-4 mr-1" /> Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => setInvoicePage((p) => Math.min(invoiceTotalPages, p + 1))} disabled={invoicePage === invoiceTotalPages} className="border-zinc-300 dark:border-zinc-700">Next <ChevronRight className="h-4 w-4 ml-1" /></Button>
                  </div>
                </div>
              )}
            </Card>
          </motion.div>

          <motion.div variants={itemVariants} className="md:hidden space-y-3">
            {invoiceLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card key={i} className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <CardContent className="p-4">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-4 w-48 mb-3" />
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-6 w-16" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : invoiceError ? (
              <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
                <CardContent className="p-8 text-center text-red-500 dark:text-red-400">
                  Error loading invoices: {invoiceError.message}
                </CardContent>
              </Card>
            ) : !selectedWarehouse ? (
              <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
                <CardContent className="p-8 text-center text-zinc-500">
                  Select a warehouse to view invoices.
                </CardContent>
              </Card>
            ) : (invoicesData?.items ?? []).length === 0 ? (
              <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
                <CardContent className="p-8 text-center text-zinc-500">
                  No invoices yet. Tap &quot;Create Invoice&quot; to add one.
                </CardContent>
              </Card>
            ) : (
              (invoicesData?.items ?? []).map((inv) => (
                <Card
                  key={inv.id}
                  className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  onClick={() => {
                    setSelectedInvoiceId(inv.id);
                    setInvoiceDetailOpen(true);
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-white">{inv.invoice_number}</p>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">{inv.customer_name}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <InvoiceStatusBadge status={inv.status} />
                        <span className="font-bold text-green-600 dark:text-green-400">{formatCurrency(inv.total)}</span>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-500">{inv.item_count} items • Due: {inv.due_date ? formatDate(inv.due_date) : "—"}</p>
                    {inv.status === "PARTIALLY_PAID" && (
                      <p className="text-xs text-amber-500 mt-1">
                        Paid: {formatCurrency(inv.amount_paid)} | Due: {formatCurrency(inv.balance_due)}
                      </p>
                    )}
                    <div className="flex gap-2 mt-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
                      {!isViewer && inv.status === "DRAFT" && (
                        <Button size="sm" variant="outline" onClick={() => confirmMutation.mutate(inv.id)} disabled={confirmMutation.isPending} className="text-xs flex-1">Confirm</Button>
                      )}
                      {!isViewer && (inv.status === "CONFIRMED" || inv.status === "PARTIALLY_PAID") && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => { setPaymentDialogInvoice(inv); setPaymentAmount(""); }} disabled={payMutation.isPending} className="text-xs flex-1">{inv.status === "PARTIALLY_PAID" ? "Record Payment" : "Mark Paid"}</Button>
                          <Button size="sm" variant="outline" onClick={() => voidMutation.mutate(inv.id)} disabled={voidMutation.isPending} className="text-xs flex-1 text-red-600">Void</Button>
                        </>
                      )}
                      <Button size="sm" variant="outline" onClick={() => { setSelectedInvoiceId(inv.id); setInvoiceDetailOpen(true); }} className="text-xs flex-1">View Details</Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
            {invoiceTotalPages > 1 && (invoicesData?.items ?? []).length > 0 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Page {invoicePage} of {invoiceTotalPages}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setInvoicePage((p) => Math.max(1, p - 1))} disabled={invoicePage === 1} className="border-zinc-300 dark:border-zinc-700"><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setInvoicePage((p) => Math.min(invoiceTotalPages, p + 1))} disabled={invoicePage === invoiceTotalPages} className="border-zinc-300 dark:border-zinc-700"><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}

      {paymentDialogInvoice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-sm bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
            <CardHeader>
              <CardTitle className="text-zinc-900 dark:text-white">Record Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Invoice: <span className="font-mono">{paymentDialogInvoice.invoice_number}</span>
              </p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Balance Due: <span className="font-bold text-amber-600 dark:text-amber-400">{formatCurrency(paymentDialogInvoice.balance_due)}</span>
              </p>
              <Input
                type="number"
                min={0}
                max={paymentDialogInvoice.balance_due}
                step={0.01}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder={`Enter amount (max: ${formatCurrency(paymentDialogInvoice.balance_due)})`}
                className="bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPaymentDialogInvoice(null)} className="flex-1 border-zinc-300 dark:border-zinc-700">
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const amt = parseFloat(paymentAmount);
                    if (paymentAmount && !isNaN(amt) && amt > 0) {
                      payMutation.mutate({ id: paymentDialogInvoice.id, amount: amt });
                    } else {
                      payMutation.mutate({ id: paymentDialogInvoice.id });
                    }
                    setPaymentDialogInvoice(null);
                    setPaymentAmount("");
                  }}
                  disabled={payMutation.isPending}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                >
                  {paymentAmount && parseFloat(paymentAmount) > 0
                    ? `Pay ${formatCurrency(parseFloat(paymentAmount))}`
                    : `Pay Full (${formatCurrency(paymentDialogInvoice.balance_due)})`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showInvoiceForm && selectedWarehouse && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl my-8">
            <InvoiceForm
              warehouseId={selectedWarehouse}
              onSuccess={() => setShowInvoiceForm(false)}
              onCancel={() => setShowInvoiceForm(false)}
            />
          </div>
        </div>
      )}

      <InvoiceDetailSheet
        invoiceId={selectedInvoiceId}
        open={invoiceDetailOpen}
        onOpenChange={setInvoiceDetailOpen}
      />
    </motion.div>
  );
}
