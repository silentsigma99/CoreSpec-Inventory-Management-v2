"use client";

/**
 * Purchases History Page
 *
 * Displays purchase batches with expandable rows showing individual items.
 * - Admin only
 * - Batch rows: item count, PO#, vendor bill#, vendor name, bill date, import date, total
 * - Expand to see items: product, quantity, retail, wholesale, cost prices
 */

import { Fragment, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

interface Warehouse {
  id: string;
  name: string;
}

interface PurchaseBatch {
  id: string;
  po_number: string | null;
  vendor_bill_number: string | null;
  vendor_name: string | null;
  bill_date: string | null;
  total_amount: number | null;
  notes: string | null;
  warehouse_id: string | null;
  created_at: string;
  item_count: number;
  computed_total: number;
}

interface BatchItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  reference_note: string | null;
  created_at: string;
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string;
    retail_price?: number;
    wholesale_price?: number;
    cost_price?: number;
  } | null;
}

interface BatchDetail extends PurchaseBatch {
  items: BatchItem[];
}

export default function PurchasesHistoryPage() {
  const { profile, isAdmin } = useAuth();
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const pageSize = 20;

  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () => api.getWarehouses(),
    enabled: isAdmin,
  });

  useEffect(() => {
    if (profile?.warehouse_id && !selectedWarehouse) {
      setSelectedWarehouse(profile.warehouse_id);
    } else if (isAdmin && warehouses?.length && !selectedWarehouse) {
      const mainWarehouse = warehouses.find((w) => (w as { is_main?: boolean }).is_main) ?? warehouses.find((w) => w.name === "Main Warehouse");
      setSelectedWarehouse(mainWarehouse?.id || warehouses[0].id);
    }
  }, [profile, isAdmin, warehouses, selectedWarehouse]);

  useEffect(() => {
    setCurrentPage(1);
    setExpandedBatchId(null);
  }, [selectedWarehouse]);

  const {
    data: batchesData,
    isLoading,
    error,
  } = useQuery<{
    items: PurchaseBatch[];
    total: number;
    page: number;
    page_size: number;
  }>({
    queryKey: ["purchase-batches", selectedWarehouse, currentPage],
    queryFn: () =>
      api.getPurchaseBatches(selectedWarehouse, {
        page: currentPage,
        page_size: pageSize,
      }),
    enabled: !!selectedWarehouse && isAdmin,
  });

  const { data: expandedBatch } = useQuery<BatchDetail>({
    queryKey: ["purchase-batch", expandedBatchId],
    queryFn: () => api.getPurchaseBatch(expandedBatchId!),
    enabled: !!expandedBatchId,
  });

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(dateString));
  };

  const formatDateTime = (dateString: string) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(dateString));
  };

  const totalPages = batchesData ? Math.ceil(batchesData.total / pageSize) : 0;
  const pageTotal =
    batchesData?.items.reduce((sum, b) => sum + (b.computed_total || 0), 0) ?? 0;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-zinc-500 dark:text-zinc-400">
          Only administrators can view purchase history.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-500 dark:text-red-400 p-4">
        Error loading purchase history: {error.message}
      </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            Purchase History
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            View purchase batches by warehouse
          </p>
        </div>

        {warehouses && (
          <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
            <SelectTrigger className="w-full sm:w-[200px] border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white">
              <SelectValue placeholder="Select warehouse" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((wh) => (
                <SelectItem key={wh.id} value={wh.id}>
                  {wh.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Total Batches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900 dark:text-white">
              {isLoading ? <Skeleton className="h-8 w-16" /> : batchesData?.total ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Page Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {isLoading ? <Skeleton className="h-8 w-20" /> : formatCurrency(pageTotal)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B] col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Showing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium text-zinc-900 dark:text-white">
              {isLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : batchesData?.items.length ? (
                `${(currentPage - 1) * pageSize + 1}-${Math.min(
                  currentPage * pageSize,
                  batchesData.total
                )} of ${batchesData.total} batches`
              ) : (
                "No purchase batches"
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="hidden md:block">
        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 p-6 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-200 dark:border-zinc-800">
                <TableHead className="text-zinc-600 dark:text-zinc-400 w-8"></TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Products</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">PO #</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Vendor Bill #</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Vendor</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Bill Date</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Import Date</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-200 dark:border-zinc-800">
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : batchesData?.items.length === 0 ? (
                <TableRow className="border-zinc-200 dark:border-zinc-800">
                  <TableCell colSpan={8} className="text-center text-zinc-500 py-12">
                    No purchase batches recorded yet. Purchases can be imported via CSV or recorded manually.
                  </TableCell>
                </TableRow>
              ) : (
                batchesData?.items.map((batch) => {
                  const isExpanded = expandedBatchId === batch.id;
                  return (
                    <Fragment key={batch.id}>
                      <TableRow
                        className={`border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50 transition-colors ${
                          isExpanded ? "bg-zinc-50/50 dark:bg-zinc-800/30" : ""
                        }`}
                        onClick={() =>
                          setExpandedBatchId(isExpanded ? null : batch.id)
                        }
                      >
                        <TableCell className="w-8">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-zinc-500" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-zinc-500" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{batch.item_count}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-zinc-600 dark:text-zinc-400">
                          {batch.po_number || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-zinc-600 dark:text-zinc-400">
                          {batch.vendor_bill_number || "—"}
                        </TableCell>
                        <TableCell className="text-zinc-700 dark:text-zinc-300">
                          {batch.vendor_name || "—"}
                        </TableCell>
                        <TableCell className="text-zinc-600 dark:text-zinc-400">
                          {formatDate(batch.bill_date)}
                        </TableCell>
                        <TableCell className="text-zinc-600 dark:text-zinc-400">
                          {formatDateTime(batch.created_at)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-amber-600 dark:text-amber-400">
                          {formatCurrency(batch.computed_total || batch.total_amount || 0)}
                        </TableCell>
                      </TableRow>

                      <AnimatePresence>
                        {isExpanded && (
                          <TableRow
                            key={`${batch.id}-expand`}
                            className="border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30"
                          >
                            <TableCell colSpan={8} className="p-0">
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <div className="p-4 pl-12">
                                  {expandedBatch?.id === batch.id ? (
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="border-zinc-200 dark:border-zinc-700">
                                          <TableHead className="text-zinc-600 dark:text-zinc-400">Product</TableHead>
                                          <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Qty</TableHead>
                                          <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Retail</TableHead>
                                          <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Wholesale</TableHead>
                                          <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Cost</TableHead>
                                          <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">Total</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {expandedBatch.items.map((item) => {
                                          const lineTotal = item.unit_price * item.quantity;
                                          return (
                                            <TableRow
                                              key={item.id}
                                              className="border-zinc-200 dark:border-zinc-700"
                                            >
                                              <TableCell>
                                                <div>
                                                  <p className="font-medium text-zinc-900 dark:text-white">
                                                    {item.product?.name || "Unknown"}
                                                  </p>
                                                  <p className="text-xs text-zinc-500 font-mono">
                                                    {item.product?.sku}
                                                  </p>
                                                </div>
                                              </TableCell>
                                              <TableCell className="text-right">
                                                <Badge variant="outline">{item.quantity}</Badge>
                                              </TableCell>
                                              <TableCell className="text-right text-zinc-500 dark:text-zinc-400">
                                                {formatCurrency(item.product?.retail_price)}
                                              </TableCell>
                                              <TableCell className="text-right text-zinc-500 dark:text-zinc-400">
                                                {formatCurrency(item.product?.wholesale_price)}
                                              </TableCell>
                                              <TableCell className="text-right text-zinc-500 dark:text-zinc-400">
                                                {formatCurrency(item.unit_price)}
                                              </TableCell>
                                              <TableCell className="text-right font-medium text-amber-600 dark:text-amber-400">
                                                {formatCurrency(lineTotal)}
                                              </TableCell>
                                            </TableRow>
                                          );
                                        })}
                                      </TableBody>
                                    </Table>
                                  ) : (
                                    <div className="py-4">
                                      <Skeleton className="h-4 w-full max-w-md" />
                                      <Skeleton className="h-4 w-3/4 mt-2" />
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            </TableCell>
                          </TableRow>
                        )}
                      </AnimatePresence>
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="border-zinc-300 dark:border-zinc-700"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="border-zinc-300 dark:border-zinc-700"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Mobile Card View */}
      <motion.div variants={itemVariants} className="md:hidden space-y-3">
        {isLoading ? (
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
        ) : batchesData?.items.length === 0 ? (
          <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
            <CardContent className="p-8 text-center text-zinc-500">
              No purchase batches recorded yet.
            </CardContent>
          </Card>
        ) : (
          batchesData?.items.map((batch) => {
            const isExpanded = expandedBatchId === batch.id;
            return (
              <Card
                key={batch.id}
                className={`bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 ${
                  isExpanded ? "ring-2 ring-blue-500/50" : ""
                }`}
              >
                <CardContent
                  className="p-4 cursor-pointer"
                  onClick={() => setExpandedBatchId(isExpanded ? null : batch.id)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-zinc-900 dark:text-white">
                        {batch.vendor_name || "Unnamed Vendor"}
                      </p>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {batch.item_count} products • PO: {batch.po_number || "—"}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        Bill: {formatDate(batch.bill_date)} • Import: {formatDateTime(batch.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-600 dark:text-amber-400">
                        {formatCurrency(batch.computed_total || batch.total_amount || 0)}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-zinc-500" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-zinc-500" />
                      )}
                    </div>
                  </div>

                  <AnimatePresence>
                    {isExpanded && expandedBatch?.id === batch.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700 space-y-3">
                          {expandedBatch.items.map((item) => {
                            const lineTotal = item.unit_price * item.quantity;
                            return (
                              <div
                                key={item.id}
                                className="flex justify-between items-center text-sm py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
                              >
                                <div>
                                  <p className="font-medium text-zinc-900 dark:text-white">
                                    {item.product?.name}
                                  </p>
                                  <p className="text-xs text-zinc-500">
                                    {item.quantity} × {formatCurrency(item.unit_price)}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="font-medium text-amber-600 dark:text-amber-400">
                                    {formatCurrency(lineTotal)}
                                  </p>
                                  <p className="text-xs text-zinc-500">
                                    R: {formatCurrency(item.product?.retail_price)} W: {formatCurrency(item.product?.wholesale_price)}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            );
          })
        )}

        {totalPages > 1 && batchesData && batchesData.items.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Page {currentPage} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="border-zinc-300 dark:border-zinc-700"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="border-zinc-300 dark:border-zinc-700"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
