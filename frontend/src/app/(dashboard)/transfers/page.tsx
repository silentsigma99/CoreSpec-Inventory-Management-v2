"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BrandFilter } from "@/components/ui/brand-filter";
import { toast } from "sonner";

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

interface InventoryItem {
  id: string;
  product_id: string;
  quantity_on_hand: number;
  product: Product;
}

interface InventoryResponse {
  warehouse_id: string;
  warehouse_name: string;
  items: InventoryItem[];
}

export default function TransfersPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [fromWarehouse, setFromWarehouse] = useState<string>("");
  const [toWarehouse, setToWarehouse] = useState<string>("");
  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [brand, setBrand] = useState<string>("all");

  // Fetch warehouses
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () => api.getWarehouses(),
  });

  // Fetch source inventory (get all items for dropdown)
  const { data: sourceInventory } = useQuery<InventoryResponse>({
    queryKey: ["inventory", fromWarehouse, "all"],
    queryFn: () => api.getInventory(fromWarehouse, { limit: 1000 }),
    enabled: !!fromWarehouse,
  });

  // Get selected product's available quantity
  const selectedProduct = sourceInventory?.items.find(
    (item) => item.product_id === productId
  );

  // Transfer mutation
  const transferMutation = useMutation({
    mutationFn: (data: {
      from_warehouse_id: string;
      to_warehouse_id: string;
      product_id: string;
      quantity: number;
      reference_note?: string;
    }) => api.createTransfer(data),
    onSuccess: () => {
      toast.success("Transfer completed successfully");
      // Reset form
      setProductId("");
      setQuantity("");
      setNote("");
      // Invalidate inventory queries
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to complete transfer");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!fromWarehouse || !toWarehouse || !productId || !quantity) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (fromWarehouse === toWarehouse) {
      toast.error("Source and destination cannot be the same");
      return;
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Quantity must be a positive number");
      return;
    }

    if (selectedProduct && qty > selectedProduct.quantity_on_hand) {
      toast.error(
        `Insufficient stock. Available: ${selectedProduct.quantity_on_hand}`
      );
      return;
    }

    transferMutation.mutate({
      from_warehouse_id: fromWarehouse,
      to_warehouse_id: toWarehouse,
      product_id: productId,
      quantity: qty,
      reference_note: note || undefined,
    });
  };

  // Only admins can access transfers
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-96">
        <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 max-w-md ring-1 ring-black/5 dark:ring-[#B8860B]">
          <CardContent className="p-8 text-center">
            <svg
              className="w-12 h-12 text-zinc-400 dark:text-zinc-600 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-2">
              Admin Access Required
            </h2>
            <p className="text-zinc-500 dark:text-zinc-400">
              Only administrators can transfer stock between warehouses.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Stock Transfer</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Move inventory between warehouses
        </p>
      </div>

      {/* Transfer Form */}
      <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 max-w-2xl ring-1 ring-black/5 dark:ring-[#B8860B]">
        <CardHeader>
          <CardTitle className="text-zinc-900 dark:text-white">New Transfer</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Source Warehouse */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                From Warehouse *
              </label>
              <Select value={fromWarehouse} onValueChange={setFromWarehouse}>
                <SelectTrigger className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white">
                  <SelectValue placeholder="Select source warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses?.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Destination Warehouse */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                To Warehouse *
              </label>
              <Select value={toWarehouse} onValueChange={setToWarehouse}>
                <SelectTrigger className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white">
                  <SelectValue placeholder="Select destination warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses
                    ?.filter((wh) => wh.id !== fromWarehouse)
                    .map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {wh.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Brand Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Filter by Brand
              </label>
              <BrandFilter value={brand} onChange={(val) => {
                setBrand(val);
                setProductId(""); // Reset product when brand changes
              }} />
            </div>

            {/* Product */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Product *
              </label>
              <Select
                value={productId}
                onValueChange={setProductId}
                disabled={!fromWarehouse}
              >
                <SelectTrigger className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white">
                  <SelectValue
                    placeholder={
                      fromWarehouse
                        ? "Select product"
                        : "Select source warehouse first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sourceInventory?.items
                    .filter((item) => item.quantity_on_hand >= 1)
                    .filter((item) => brand === "all" || item.product.brand === brand)
                    .map((item) => (
                      <SelectItem key={item.product_id} value={item.product_id}>
                        {item.product.name} ({item.quantity_on_hand} available)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {selectedProduct && (
                <p className="text-sm text-zinc-500">
                  Available: {selectedProduct.quantity_on_hand} units
                </p>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Quantity *
              </label>
              <Input
                type="number"
                min="1"
                max={selectedProduct?.quantity_on_hand}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Enter quantity"
                className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white"
              />
            </div>

            {/* Note */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Note (optional)
              </label>
              <Input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a reference note"
                className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white"
              />
            </div>

            {/* Submit */}
            <Button
              type="submit"
              className="w-full"
              disabled={transferMutation.isPending}
            >
              {transferMutation.isPending ? "Processing..." : "Transfer Stock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
