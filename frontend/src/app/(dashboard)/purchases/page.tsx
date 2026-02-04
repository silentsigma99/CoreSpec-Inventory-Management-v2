"use client";

/**
 * Purchases History Page
 *
 * Displays a history of all purchase (restock) transactions for the warehouse.
 * - Admin only page (only admins can record purchases)
 * - Shows RESTOCK transactions with cost information
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
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
import { BrandFilter } from "@/components/ui/brand-filter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Types for API responses
interface Warehouse {
  id: string;
  name: string;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  cost_price?: number;
}

interface Transaction {
  id: string;
  transaction_type: string;
  product_id: string;
  from_warehouse_id?: string;
  to_warehouse_id?: string;
  quantity: number;
  unit_price?: number; // For RESTOCK, this stores cost
  reference_note?: string;
  created_by?: string;
  created_at: string;
  product?: Product;
}

interface TransactionListResponse {
  items: Transaction[];
  total: number;
  page: number;
  page_size: number;
}

export default function PurchasesHistoryPage() {
  const { profile, isAdmin } = useAuth();
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [brand, setBrand] = useState<string>("all");
  const pageSize = 20;

  // Fetch warehouses (for admin dropdown)
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () => api.getWarehouses(),
    enabled: isAdmin,
  });

  // Set default warehouse based on user role
  useEffect(() => {
    if (profile?.warehouse_id && !selectedWarehouse) {
      setSelectedWarehouse(profile.warehouse_id);
    } else if (isAdmin && warehouses?.length && !selectedWarehouse) {
      // Default to Main Warehouse for admins
      const mainWarehouse = warehouses.find(w => w.name === "Main Warehouse");
      setSelectedWarehouse(mainWarehouse?.id || warehouses[0].id);
    }
  }, [profile, isAdmin, warehouses, selectedWarehouse]);

  // Reset page when warehouse or brand changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedWarehouse, brand]);

  // Fetch purchase (RESTOCK) transactions for the selected warehouse
  const {
    data: transactions,
    isLoading,
    error,
  } = useQuery<TransactionListResponse>({
    queryKey: ["transactions", selectedWarehouse, "RESTOCK", currentPage, brand],
    queryFn: () =>
      api.getTransactions(selectedWarehouse, {
        transaction_type: "RESTOCK",
        page: currentPage,
        page_size: pageSize,
        brand: brand === "all" ? undefined : brand,
      }),
    enabled: !!selectedWarehouse,
  });

  // Calculate pagination info
  const totalPages = transactions
    ? Math.ceil(transactions.total / pageSize)
    : 0;

  /**
   * Format date for display
   */
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  /**
   * Calculate total cost from current page
   */
  const pageCost =
    transactions?.items.reduce((sum, t) => {
      const cost = t.unit_price || 0;
      return sum + cost * t.quantity;
    }, 0) || 0;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  // Only admins can access this page
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
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            Purchase History
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            View inventory restock transactions
          </p>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          {/* Brand Filter */}
          <BrandFilter value={brand} onChange={setBrand} />

          {/* Warehouse selector */}
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
        </div>
      </motion.div>

      {/* Stats Cards */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-2 md:grid-cols-3 gap-4"
      >
        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Total Purchases
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900 dark:text-white">
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                transactions?.total || 0
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Page Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                formatCurrency(pageCost)
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B] col-span-2 md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Showing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium text-zinc-900 dark:text-white">
              {isLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : transactions?.items.length ? (
                `${(currentPage - 1) * pageSize + 1}-${Math.min(
                  currentPage * pageSize,
                  transactions.total
                )} of ${transactions.total}`
              ) : (
                "No purchases"
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Desktop Table View */}
      <motion.div variants={itemVariants} className="hidden md:block">
        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 p-6 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50">
                <TableHead className="text-zinc-600 dark:text-zinc-400">
                  Product
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Qty
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Unit Cost
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Total Cost
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">
                  Note
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow
                    key={i}
                    className="border-zinc-200 dark:border-zinc-800"
                  >
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-12 ml-auto" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16 ml-auto" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20 ml-auto" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                  </TableRow>
                ))
              ) : transactions?.items.length === 0 ? (
                <TableRow className="border-zinc-200 dark:border-zinc-800">
                  <TableCell
                    colSpan={5}
                    className="text-center text-zinc-500 py-8"
                  >
                    No purchases recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                transactions?.items.map((transaction) => {
                  const total =
                    (transaction.unit_price || 0) * transaction.quantity;

                  return (
                    <TableRow
                      key={transaction.id}
                      className="border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50"
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium text-zinc-900 dark:text-white">
                            {transaction.product?.name || "Unknown Product"}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {transaction.product?.sku}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{transaction.quantity}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-zinc-600 dark:text-zinc-400">
                        {formatCurrency(transaction.unit_price)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-amber-600 dark:text-amber-400">
                        {formatCurrency(total)}
                      </TableCell>
                      <TableCell className="text-zinc-500 dark:text-zinc-400 text-sm max-w-[150px] truncate">
                        {transaction.reference_note || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
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
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
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
            <Card
              key={i}
              className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
            >
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
        ) : transactions?.items.length === 0 ? (
          <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
            <CardContent className="p-8 text-center text-zinc-500">
              No purchases recorded yet.
            </CardContent>
          </Card>
        ) : (
          <>
            {transactions?.items.map((transaction) => {
              const total =
                (transaction.unit_price || 0) * transaction.quantity;

              return (
                <Card
                  key={transaction.id}
                  className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                >
                  <CardContent className="p-4">
                    {/* Product and total */}
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-white">
                          {transaction.product?.name || "Unknown Product"}
                        </p>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          {transaction.product?.sku}
                        </p>
                      </div>
                      <p className="font-bold text-lg text-amber-600 dark:text-amber-400">
                        {formatCurrency(total)}
                      </p>
                    </div>

                    {/* Details row */}
                    <div className="flex justify-between items-center text-sm mb-2">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {formatDate(transaction.created_at)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {transaction.quantity} ×{" "}
                          {formatCurrency(transaction.unit_price)}
                        </span>
                      </div>
                    </div>

                    {/* Note if present */}
                    {transaction.reference_note && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-700 pt-2 mt-2 truncate">
                        {transaction.reference_note}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            {/* Mobile Pagination */}
            {totalPages > 1 && (
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
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage === totalPages}
                    className="border-zinc-300 dark:border-zinc-700"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
