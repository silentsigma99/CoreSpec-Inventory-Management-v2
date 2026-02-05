"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { X, Plus, Search } from "lucide-react";

interface InvoiceFormProps {
  warehouseId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

interface InventoryItem {
  id: string;
  product_id: string;
  quantity_on_hand: number;
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string;
    retail_price?: number;
    wholesale_price?: number;
    cost_price?: number;
  };
}

interface LineItem {
  product_id: string;
  product_sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
}

export function InvoiceForm({ warehouseId, onSuccess, onCancel }: InvoiceFormProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const { data: inventory, isLoading: inventoryLoading } = useQuery<{
    items: InventoryItem[];
  }>({
    queryKey: ["inventory", warehouseId, search],
    queryFn: () =>
      api.getInventory(warehouseId, {
        page: 1,
        limit: 20,
        search: search || undefined,
      }),
    enabled: !!warehouseId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createInvoice>[0]) =>
      api.createInvoice(data),
    onSuccess: () => {
      toast.success("Invoice created");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      onSuccess?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addItem = (item: InventoryItem) => {
    if (item.quantity_on_hand <= 0) return;
    const existing = lineItems.find((l) => l.product_id === item.product_id);
    if (existing) {
      setLineItems((prev) =>
        prev.map((l) =>
          l.product_id === item.product_id
            ? { ...l, quantity: Math.min(l.quantity + 1, item.quantity_on_hand) }
            : l
        )
      );
    } else {
      const price = item.product.retail_price ?? item.product.wholesale_price ?? 0;
      setLineItems((prev) => [
        ...prev,
        {
          product_id: item.product_id,
          product_sku: item.product.sku,
          product_name: item.product.name,
          quantity: 1,
          unit_price: price,
        },
      ]);
    }
  };

  const updateLineItem = (productId: string, field: "quantity" | "unit_price", value: number) => {
    setLineItems((prev) =>
      prev.map((l) =>
        l.product_id === productId ? { ...l, [field]: value } : l
      )
    );
  };

  const removeLineItem = (productId: string) => {
    setLineItems((prev) => prev.filter((l) => l.product_id !== productId));
  };

  const subtotal = lineItems.reduce(
    (sum, l) => sum + l.quantity * l.unit_price,
    0
  );

  const handleSubmit = () => {
    if (!customerName.trim()) {
      toast.error("Customer name is required");
      return;
    }
    if (lineItems.length === 0) {
      toast.error("Add at least one product");
      return;
    }
    createMutation.mutate({
      warehouse_id: warehouseId,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim() || undefined,
      customer_address: customerAddress.trim() || undefined,
      customer_email: customerEmail.trim() || undefined,
      due_date: dueDate || undefined,
      notes: notes.trim() || undefined,
      items: lineItems.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
    });
  };

  return (
    <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Create Invoice</CardTitle>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Customer Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="John Doe"
              className="bg-white dark:bg-zinc-800"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Phone</label>
            <Input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+1 234 567 8900"
              className="bg-white dark:bg-zinc-800"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Address</label>
            <Input
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="123 Main St, City"
              className="bg-white dark:bg-zinc-800"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
            <Input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="john@example.com"
              className="bg-white dark:bg-zinc-800"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Due Date</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="bg-white dark:bg-zinc-800"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Notes</label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
            className="bg-white dark:bg-zinc-800"
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Add Products
            </label>
            <div className="relative w-48">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                className="pl-8 h-9 bg-white dark:bg-zinc-800 text-sm"
              />
            </div>
          </div>

          {inventoryLoading ? (
            <p className="text-sm text-zinc-500">Loading products...</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              {inventory?.items
                ?.filter((i) => i.quantity_on_hand > 0)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addItem(item)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm text-left"
                  >
                    <Plus className="h-3 w-3" />
                    <span className="font-medium truncate max-w-[120px]">
                      {item.product.name}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {item.quantity_on_hand}
                    </Badge>
                  </button>
                ))}
              {(!inventory?.items?.length || inventory.items.filter((i) => i.quantity_on_hand > 0).length === 0) && (
                <p className="text-sm text-zinc-500 py-2">No products with stock found</p>
              )}
            </div>
          )}

          {lineItems.length > 0 && (
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
              <div className="grid grid-cols-12 gap-2 p-3 bg-zinc-50 dark:bg-zinc-800/50 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                <div className="col-span-5">Product</div>
                <div className="col-span-2 text-right">Qty</div>
                <div className="col-span-2 text-right">Price</div>
                <div className="col-span-2 text-right">Total</div>
                <div className="col-span-1" />
              </div>
              {lineItems.map((item) => (
                <div
                  key={item.product_id}
                  className="grid grid-cols-12 gap-2 p-3 border-t border-zinc-200 dark:border-zinc-700 items-center"
                >
                  <div className="col-span-5">
                    <p className="font-medium text-zinc-900 dark:text-white truncate">
                      {item.product_name}
                    </p>
                    <p className="text-xs text-zinc-500 font-mono">{item.product_sku}</p>
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        updateLineItem(
                          item.product_id,
                          "quantity",
                          Math.max(1, parseInt(e.target.value, 10) || 1)
                        )
                      }
                      className="h-8 text-sm text-right bg-white dark:bg-zinc-800"
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.unit_price}
                      onChange={(e) =>
                        updateLineItem(
                          item.product_id,
                          "unit_price",
                          Math.max(0, parseFloat(e.target.value) || 0)
                        )
                      }
                      className="h-8 text-sm text-right bg-white dark:bg-zinc-800"
                    />
                  </div>
                  <div className="col-span-2 text-right font-medium text-zinc-900 dark:text-white">
                    {formatCurrency(item.quantity * item.unit_price)}
                  </div>
                  <div className="col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLineItem(item.product_id)}
                      className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="p-3 border-t border-zinc-200 dark:border-zinc-700 flex justify-end">
                <span className="text-lg font-bold text-zinc-900 dark:text-white">
                  Total: {formatCurrency(subtotal)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} className="border-zinc-300 dark:border-zinc-700">
              Cancel
            </Button>
          )}
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !customerName.trim() || lineItems.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {createMutation.isPending ? "Creating..." : "Create Invoice"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
