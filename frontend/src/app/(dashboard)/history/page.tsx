"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

interface Warehouse {
  id: string;
  name: string;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
}

interface Transaction {
  id: string;
  transaction_type: string;
  product_id: string;
  from_warehouse_id?: string;
  to_warehouse_id?: string;
  quantity: number;
  reference_note?: string;
  created_at: string;
  product?: Product;
  from_warehouse?: Warehouse;
  to_warehouse?: Warehouse;
}

interface TransactionListResponse {
  items: Transaction[];
  total: number;
  page: number;
  page_size: number;
}

const transactionTypeColors: Record<string, string> = {
  SALE: "bg-red-500/20 text-red-400 border-red-500/30",
  RESTOCK: "bg-green-500/20 text-green-400 border-green-500/30",
  TRANSFER_OUT: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  TRANSFER_IN: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  ADJUSTMENT: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const transactionTypeLabels: Record<string, string> = {
  SALE: "Sale",
  RESTOCK: "Restock",
  TRANSFER_OUT: "Transfer Out",
  TRANSFER_IN: "Transfer In",
  ADJUSTMENT: "Adjustment",
};

export default function HistoryPage() {
  const { profile, isAdmin } = useAuth();

  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [brand, setBrand] = useState<string>("all");

  // Fetch warehouses (for admin dropdown)
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () => api.getWarehouses(),
    enabled: isAdmin,
  });

  // Set default warehouse
  useEffect(() => {
    if (profile?.warehouse_id && !selectedWarehouse) {
      setSelectedWarehouse(profile.warehouse_id);
    } else if (isAdmin && warehouses?.length && !selectedWarehouse) {
      setSelectedWarehouse(warehouses[0].id);
    }
  }, [profile, isAdmin, warehouses, selectedWarehouse]);

  // Fetch transactions
  const { data: transactionsData, isLoading } = useQuery<TransactionListResponse>({
    queryKey: [
      "transactions",
      selectedWarehouse,
      typeFilter === "all" ? undefined : typeFilter,
      brand,
    ],
    queryFn: () =>
      api.getTransactions(selectedWarehouse, {
        transaction_type: typeFilter === "all" ? undefined : typeFilter,
        page_size: 50,
        brand: brand === "all" ? undefined : brand,
      }),
    enabled: !!selectedWarehouse,
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Transaction History</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">Audit trail of all stock movements</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Type filter */}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[160px] bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="SALE">Sales</SelectItem>
              <SelectItem value="RESTOCK">Restocks</SelectItem>
              <SelectItem value="TRANSFER_OUT">Transfers Out</SelectItem>
              <SelectItem value="TRANSFER_IN">Transfers In</SelectItem>
              <SelectItem value="ADJUSTMENT">Adjustments</SelectItem>
            </SelectContent>
          </Select>

          {/* Brand filter */}
          <BrandFilter value={brand} onChange={setBrand} />

          {/* Warehouse selector (admin only) */}
          {isAdmin && warehouses && (
            <Select
              value={selectedWarehouse}
              onValueChange={setSelectedWarehouse}
            >
              <SelectTrigger className="w-full sm:w-[200px] bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white">
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
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block">
        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50">
                <TableHead className="text-zinc-600 dark:text-zinc-400">Date</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Type</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Product</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Quantity</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">From/To</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-200 dark:border-zinc-800">
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  </TableRow>
                ))
              ) : transactionsData?.items.length === 0 ? (
                <TableRow className="border-zinc-200 dark:border-zinc-800">
                  <TableCell colSpan={6} className="text-center text-zinc-500 py-8">
                    No transactions found
                  </TableCell>
                </TableRow>
              ) : (
                transactionsData?.items.map((tx) => (
                  <TableRow key={tx.id} className="border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50">
                    <TableCell className="text-zinc-500 dark:text-zinc-400">
                      {formatDate(tx.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={transactionTypeColors[tx.transaction_type]}
                      >
                        {transactionTypeLabels[tx.transaction_type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-zinc-900 dark:text-white">
                      {tx.product?.name || "Unknown"}
                    </TableCell>
                    <TableCell className="font-medium text-zinc-900 dark:text-white">
                      {tx.quantity}
                    </TableCell>
                    <TableCell className="text-zinc-500 dark:text-zinc-400 text-sm">
                      {tx.transaction_type === "SALE" && "—"}
                      {tx.transaction_type === "RESTOCK" && "—"}
                      {tx.transaction_type === "TRANSFER_OUT" &&
                        `→ ${tx.to_warehouse?.name || "Unknown"}`}
                      {tx.transaction_type === "TRANSFER_IN" &&
                        `← ${tx.from_warehouse?.name || "Unknown"}`}
                    </TableCell>
                    <TableCell className="text-zinc-500 max-w-[150px] truncate">
                      {tx.reference_note || "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
              <CardContent className="p-4">
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-48 mb-3" />
                <div className="flex justify-between">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : transactionsData?.items.length === 0 ? (
          <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
            <CardContent className="p-8 text-center text-zinc-500">
              No transactions found
            </CardContent>
          </Card>
        ) : (
          transactionsData?.items.map((tx) => (
            <Card key={tx.id} className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-white">
                      {tx.product?.name || "Unknown"}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {formatDate(tx.created_at)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={transactionTypeColors[tx.transaction_type]}
                  >
                    {transactionTypeLabels[tx.transaction_type]}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {tx.transaction_type === "TRANSFER_OUT" &&
                      `→ ${tx.to_warehouse?.name}`}
                    {tx.transaction_type === "TRANSFER_IN" &&
                      `← ${tx.from_warehouse?.name}`}
                    {tx.reference_note && tx.transaction_type === "SALE" && (
                      <span className="text-sm">{tx.reference_note}</span>
                    )}
                  </span>
                  <span className="text-lg font-semibold text-zinc-900 dark:text-white">
                    {tx.quantity} units
                  </span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Pagination info */}
      {transactionsData && (
        <p className="text-sm text-zinc-500 text-center">
          Showing {transactionsData.items.length} of {transactionsData.total}{" "}
          transactions
        </p>
      )}
    </div>
  );
}
