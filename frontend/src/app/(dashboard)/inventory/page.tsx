"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
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
import { toast } from "sonner";
import { ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";

interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category?: string;
  retail_price?: number;      // Customer-facing retail price
  wholesale_price?: number;   // B2B/reseller pricing tier
  cost_price?: number;        // Product cost for margin calculations
}

interface InventoryItem {
  id: string;
  warehouse_id: string;
  product_id: string;
  quantity_on_hand: number;
  product: Product;
}

interface InventoryResponse {
  warehouse_id: string;
  warehouse_name: string;
  items: InventoryItem[];
  total_items: number;
  low_stock_count: number;
  page: number;
  page_size: number;
}

interface Warehouse {
  id: string;
  name: string;
  is_main?: boolean;
}

export default function InventoryPage() {
  const { profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [brand, setBrand] = useState<string>("all");
  const pageSize = 50;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1); // Reset to page 1 on search
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset to page 1 when brand filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [brand]);

  // Quick-sell state
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [mobileSheetItem, setMobileSheetItem] = useState<InventoryItem | null>(null);
  const [sellQuantity, setSellQuantity] = useState<string>("1");
  const [sellPrice, setSellPrice] = useState<string>("");
  const [sellNote, setSellNote] = useState<string>("");

  // Quick-transfer state (Main Warehouse only)
  const [transferQuantity, setTransferQuantity] = useState<string>("1");
  const [transferDestination, setTransferDestination] = useState<string>("");
  const [transferNote, setTransferNote] = useState<string>("");

  // Fetch warehouses (for admin dropdown)
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () => api.getWarehouses(),
    enabled: isAdmin,
  });

  const selectedWarehouseData = warehouses?.find((w) => w.id === selectedWarehouse);
  const isMainWarehouse = isAdmin && selectedWarehouseData?.is_main === true;
  const showTransferUI = isMainWarehouse;
  const partnerWarehouses = useMemo(() => warehouses?.filter((w) => !w.is_main) ?? [], [warehouses]);

  // Set default warehouse
  useEffect(() => {
    if (profile?.warehouse_id && !selectedWarehouse) {
      setSelectedWarehouse(profile.warehouse_id);
    } else if (isAdmin && warehouses?.length && !selectedWarehouse) {
      const mainWarehouse = warehouses.find((wh) => wh.is_main) ?? warehouses.find((wh) => wh.name === "Main Warehouse");
      setSelectedWarehouse(mainWarehouse?.id || warehouses[0].id);
    }
  }, [profile, isAdmin, warehouses, selectedWarehouse]);

  // Set default transfer destination when partner warehouses load
  useEffect(() => {
    if (showTransferUI && partnerWarehouses.length > 0 && !transferDestination) {
      setTransferDestination(partnerWarehouses[0].id);
    }
  }, [showTransferUI, partnerWarehouses, transferDestination]);

  // Fetch inventory for selected warehouse
  const {
    data: inventory,
    isLoading,
    error,
  } = useQuery<InventoryResponse>({
    queryKey: ["inventory", selectedWarehouse, currentPage, debouncedSearch, brand],
    queryFn: () => api.getInventory(selectedWarehouse, {
      page: currentPage,
      limit: pageSize,
      search: debouncedSearch,
      brand: brand === "all" ? undefined : brand,
    }),
    enabled: !!selectedWarehouse,
  });

  // Sale mutation for quick-sell
  const saleMutation = useMutation({
    mutationFn: (data: {
      warehouse_id: string;
      product_id: string;
      quantity: number;
      unit_price?: number;
      reference_note?: string;
    }) => api.recordSale(data),
    onSuccess: (data) => {
      toast.success(`Sale recorded! New stock: ${data.new_stock_level} units`);
      resetSellForm();
      setExpandedRowId(null);
      setMobileSheetItem(null);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to record sale");
    },
  });

  // Transfer mutation (Main Warehouse)
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
      resetTransferForm();
      setExpandedRowId(null);
      setMobileSheetItem(null);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to transfer");
    },
  });

  const resetSellForm = () => {
    setSellQuantity("1");
    setSellPrice("");
    setSellNote("");
  };

  const resetTransferForm = () => {
    setTransferQuantity("1");
    setTransferDestination(partnerWarehouses[0]?.id ?? "");
    setTransferNote("");
  };

  const handleRowClick = (item: InventoryItem, isMobile: boolean) => {
    if (item.quantity_on_hand <= 0) {
      toast.error(showTransferUI ? "No stock available to transfer" : "No stock available to sell");
      return;
    }

    if (isMobile) {
      if (showTransferUI) {
        setTransferQuantity("1");
        setTransferDestination(partnerWarehouses[0]?.id ?? "");
        setTransferNote("");
      } else {
        setSellPrice(item.product.retail_price?.toString() || "");
        setSellQuantity("1");
        setSellNote("");
      }
      setMobileSheetItem(item);
      setExpandedRowId(null);
    } else {
      if (expandedRowId === item.id) {
        setExpandedRowId(null);
        resetSellForm();
        resetTransferForm();
      } else {
        if (showTransferUI) {
          setTransferQuantity("1");
          setTransferDestination(partnerWarehouses[0]?.id ?? "");
          setTransferNote("");
        } else {
          setSellPrice(item.product.retail_price?.toString() || "");
          setSellQuantity("1");
          setSellNote("");
        }
        setExpandedRowId(item.id);
      }
    }
  };

  /**
   * Handle sale submission
   */
  const handleSaleSubmit = (item: InventoryItem) => {
    const qty = parseInt(sellQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Quantity must be a positive number");
      return;
    }

    if (qty > item.quantity_on_hand) {
      toast.error(`Insufficient stock. Available: ${item.quantity_on_hand}`);
      return;
    }

    const price = sellPrice ? parseFloat(sellPrice) : undefined;
    if (price !== undefined && (isNaN(price) || price < 0)) {
      toast.error("Price must be a valid positive number");
      return;
    }

    // Margin protection: price must be >= cost_price
    const costPrice = item.product.cost_price;
    if (price !== undefined && costPrice !== undefined && price < costPrice) {
      toast.error(
        `Price (${formatCurrency(price)}) cannot be below cost (${formatCurrency(costPrice)})`
      );
      return;
    }

    // Validate customer/note is provided
    if (!sellNote.trim()) {
      toast.error("Customer / Note is required");
      return;
    }

    saleMutation.mutate({
      warehouse_id: selectedWarehouse,
      product_id: item.product_id,
      quantity: qty,
      unit_price: price,
      reference_note: sellNote.trim(),
    });
  };

  const handleCancel = () => {
    setExpandedRowId(null);
    setMobileSheetItem(null);
    resetSellForm();
    resetTransferForm();
  };

  const handleTransferSubmit = (item: InventoryItem) => {
    const qty = parseInt(transferQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Quantity must be a positive number");
      return;
    }
    if (qty > item.quantity_on_hand) {
      toast.error(`Insufficient stock. Available: ${item.quantity_on_hand}`);
      return;
    }
    if (!transferDestination) {
      toast.error("Please select a destination warehouse");
      return;
    }
    transferMutation.mutate({
      from_warehouse_id: selectedWarehouse,
      to_warehouse_id: transferDestination,
      product_id: item.product_id,
      quantity: qty,
      reference_note: transferNote.trim() || undefined,
    });
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  if (error) {
    return (
      <div className="text-red-500 dark:text-red-400 p-4">
        Error loading inventory: {error.message}
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
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Inventory</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            View and manage stock levels
          </p>
        </div>

        <div className="flex gap-4 items-center flex-wrap">
          {/* Search Input */}
          <div className="relative">
            <Input
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-[250px] bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
            />
          </div>

          {/* Brand Filter */}
          <BrandFilter value={brand} onChange={setBrand} />

          {/* Warehouse selector (admin only) */}
          {isAdmin && warehouses && (
            <Select value={selectedWarehouse} onValueChange={(val) => {
              setSelectedWarehouse(val);
              setCurrentPage(1);
            }}>
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
      <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="!py-0 bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <CardContent className="p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Products</span>
            <span className="text-xl font-bold text-zinc-900 dark:text-white">
              {isLoading ? <Skeleton className="h-6 w-10" /> : inventory?.total_items || 0}
            </span>
          </CardContent>
        </Card>

        <Card className="!py-0 bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <CardContent className="p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Low Stock</span>
            <span className="text-xl font-bold text-red-600 dark:text-red-400">
              {isLoading ? <Skeleton className="h-6 w-10" /> : inventory?.low_stock_count || 0}
            </span>
          </CardContent>
        </Card>

        <Card className="!py-0 bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <CardContent className="p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Total Units</span>
            <span className="text-xl font-bold text-zinc-900 dark:text-white">
              {isLoading ? <Skeleton className="h-6 w-10" /> : inventory?.items.reduce((sum, item) => sum + item.quantity_on_hand, 0) || 0}
            </span>
          </CardContent>
        </Card>
      </motion.div>

      {/* Desktop Table View */}
      <motion.div variants={itemVariants} className="hidden md:block">
        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 p-6 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B]">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50">
                <TableHead className="text-zinc-600 dark:text-zinc-400 w-8"></TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Product Code</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Product</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Brand</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Quantity
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Retail Price
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Wholesale Price
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Cost Price
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-200 dark:border-zinc-800">
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : inventory?.items.length === 0 ? (
                <TableRow className="border-zinc-200 dark:border-zinc-800">
                  <TableCell
                    colSpan={8}
                    className="text-center text-zinc-500 py-8"
                  >
                    No inventory items found
                  </TableCell>
                </TableRow>
              ) : (
                inventory?.items.map((item) => {
                  const isExpanded = expandedRowId === item.id;
                  const hasStock = item.quantity_on_hand > 0;

                  return (
                    <Fragment key={item.id}>
                      {/* Main inventory row - clickable to expand */}
                      <TableRow
                        className={`border-zinc-200 dark:border-zinc-800 transition-colors ${hasStock
                          ? "cursor-pointer hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50"
                          : "opacity-60"
                          } ${isExpanded ? "bg-zinc-100/50 dark:bg-zinc-800/50" : ""}`}
                        onClick={() => hasStock && handleRowClick(item, false)}
                      >
                        {/* Expand indicator */}
                        <TableCell className="w-8">
                          {hasStock && (
                            isExpanded
                              ? <ChevronDown className="h-4 w-4 text-zinc-500" />
                              : <ChevronRight className="h-4 w-4 text-zinc-500" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-zinc-600 dark:text-zinc-300">
                          {item.product.sku}
                        </TableCell>
                        <TableCell className="font-medium text-zinc-900 dark:text-white">
                          {item.product.name}
                        </TableCell>
                        <TableCell className="text-zinc-500 dark:text-zinc-400">
                          {item.product.brand}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.quantity_on_hand < 5 ? (
                            <Badge variant="destructive">
                              {item.quantity_on_hand}
                            </Badge>
                          ) : (
                            <span className="text-zinc-900 dark:text-white">{item.quantity_on_hand}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-zinc-500 dark:text-zinc-400">
                          {formatCurrency(item.product.retail_price)}
                        </TableCell>
                        <TableCell className="text-right text-zinc-500 dark:text-zinc-400">
                          {formatCurrency(item.product.wholesale_price)}
                        </TableCell>
                        <TableCell className="text-right text-zinc-500 dark:text-zinc-400">
                          {formatCurrency(item.product.cost_price)}
                        </TableCell>
                      </TableRow>

                      {/* Expanded row: Transfer (Main Warehouse) or Sale */}
                      <AnimatePresence>
                        {isExpanded && (
                          <TableRow
                            key={`${item.id}-expand`}
                            className="border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 shadow-inner"
                          >
                            <TableCell colSpan={8} className="p-0">
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3, ease: "easeInOut" }}
                                className="overflow-hidden"
                              >
                                <div className="p-6">
                                  {showTransferUI ? (
                                    <div className="flex items-start gap-6">
                                      <div className="space-y-2">
                                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block">
                                          Destination
                                        </label>
                                        <Select
                                          value={transferDestination}
                                          onValueChange={setTransferDestination}
                                        >
                                          <SelectTrigger
                                            className="w-[180px] bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <SelectValue placeholder="Select warehouse" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {partnerWarehouses.map((wh) => (
                                              <SelectItem key={wh.id} value={wh.id}>
                                                {wh.name}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="space-y-2">
                                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block">
                                          Quantity
                                        </label>
                                        <Input
                                          type="number"
                                          min="1"
                                          max={item.quantity_on_hand}
                                          value={transferQuantity}
                                          onChange={(e) => setTransferQuantity(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-32 bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                        />
                                        <p className="text-[10px] text-zinc-500 pl-1">Max: {item.quantity_on_hand}</p>
                                      </div>
                                      <div className="space-y-2 flex-1 min-w-[200px]">
                                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block">
                                          Note (optional)
                                        </label>
                                        <Input
                                          type="text"
                                          value={transferNote}
                                          onChange={(e) => setTransferNote(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          placeholder="e.g., Transfer to CarProofing"
                                          className="w-full bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                        />
                                      </div>
                                      <div className="pt-6 flex gap-3">
                                        <Button
                                          variant="outline"
                                          onClick={(e) => { e.stopPropagation(); handleCancel(); }}
                                          className="border-zinc-300 dark:border-zinc-700"
                                        >
                                          Cancel
                                        </Button>
                                        <Button
                                          onClick={(e) => { e.stopPropagation(); handleTransferSubmit(item); }}
                                          disabled={transferMutation.isPending || !transferDestination}
                                          className="bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]"
                                        >
                                          {transferMutation.isPending ? "Processing..." : "Confirm Transfer"}
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-start gap-6">
                                      <div className="space-y-2">
                                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block">Quantity</label>
                                        <Input
                                          type="number"
                                          min="1"
                                          max={item.quantity_on_hand}
                                          value={sellQuantity}
                                          onChange={(e) => setSellQuantity(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-32 bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                        />
                                        <p className="text-[10px] text-zinc-500 pl-1">Max: {item.quantity_on_hand}</p>
                                      </div>
                                      <div className="space-y-2">
                                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block">Unit Price</label>
                                        <div className="relative">
                                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">PKR</span>
                                          <Input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={sellPrice}
                                            onChange={(e) => setSellPrice(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            placeholder="0.00"
                                            className="w-40 pl-10 bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                          />
                                        </div>
                                        {item.product.cost_price && (
                                          <p className="text-[10px] text-zinc-500 pl-1">Min: <span className="text-amber-600 dark:text-amber-500">{formatCurrency(item.product.cost_price)}</span></p>
                                        )}
                                      </div>
                                      <div className="space-y-2 flex-1 min-w-[200px]">
                                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block">Customer / Note <span className="text-red-500">*</span></label>
                                        <Input
                                          type="text"
                                          value={sellNote}
                                          onChange={(e) => setSellNote(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          placeholder="e.g., John's Auto Shop"
                                          className="w-full bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                          required
                                        />
                                      </div>
                                      <div className="pt-6 flex gap-3">
                                        <Button variant="outline" onClick={(e) => { e.stopPropagation(); handleCancel(); }} className="border-zinc-300 dark:border-zinc-700">
                                          Cancel
                                        </Button>
                                        <Button
                                          onClick={(e) => { e.stopPropagation(); handleSaleSubmit(item); }}
                                          disabled={saleMutation.isPending}
                                          className="bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]"
                                        >
                                          {saleMutation.isPending ? "Processing..." : "Confirm Sale"}
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                  {!showTransferUI && sellQuantity && sellPrice && (
                                    <div className="mt-4 pt-4 border-t border-zinc-200/60 dark:border-zinc-700/60 flex gap-6 text-sm">
                                      <p className="text-zinc-600 dark:text-zinc-400">
                                        Total: <span className="font-semibold text-zinc-900 dark:text-white">{formatCurrency(parseFloat(sellPrice || "0") * parseInt(sellQuantity || "0", 10))}</span>
                                      </p>
                                      <p className="text-zinc-600 dark:text-zinc-400">
                                        Stock after sale: <span className="font-medium text-zinc-900 dark:text-white">{item.quantity_on_hand - parseInt(sellQuantity || "0", 10)} units</span>
                                      </p>
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

          {/* Pagination Controls */}
          {inventory && inventory.total_items > pageSize && (
            <div className="flex items-center justify-between p-4 border-t border-zinc-200 dark:border-zinc-800">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Page {currentPage} of {Math.ceil(inventory.total_items / pageSize)}
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
                  onClick={() => setCurrentPage((p) => Math.min(Math.ceil(inventory.total_items / pageSize), p + 1))}
                  disabled={currentPage >= Math.ceil(inventory.total_items / pageSize)}
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
                  <Skeleton className="h-6 w-12" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : inventory?.items.length === 0 ? (
          <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 ring-1 ring-black/5 dark:ring-[#B8860B]">
            <CardContent className="p-8 text-center text-zinc-500">
              No inventory items found
            </CardContent>
          </Card>
        ) : (
          inventory?.items.map((item) => {
            const hasStock = item.quantity_on_hand > 0;

            return (
              <Card
                key={item.id}
                className={`bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 transition-colors ${hasStock
                  ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 active:bg-zinc-100 dark:active:bg-zinc-800"
                  : "opacity-60"
                  }`}
                onClick={() => hasStock && handleRowClick(item, true)}
              >
                <CardContent className="p-4">
                  {/* Product info and quantity badge */}
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium text-zinc-900 dark:text-white">{item.product.name}</p>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{item.product.brand}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.quantity_on_hand < 5 ? (
                        <Badge variant="destructive" className="ml-2">
                          {item.quantity_on_hand}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="ml-2">
                          {item.quantity_on_hand}
                        </Badge>
                      )}
                      {hasStock && (
                        <ChevronRight className="h-4 w-4 text-zinc-400" />
                      )}
                    </div>
                  </div>
                  {/* SKU */}
                  <div className="mb-2">
                    <span className="font-mono text-sm text-zinc-500">
                      {item.product.sku}
                    </span>
                  </div>
                  {/* Pricing grid - Retail | Wholesale | Cost */}
                  <div className="grid grid-cols-3 gap-2 text-xs border-t border-zinc-200 dark:border-zinc-700 pt-2">
                    <div className="text-center">
                      <p className="text-zinc-400 dark:text-zinc-500">Retail</p>
                      <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {formatCurrency(item.product.retail_price)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-zinc-400 dark:text-zinc-500">Wholesale</p>
                      <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {formatCurrency(item.product.wholesale_price)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-zinc-400 dark:text-zinc-500">Cost</p>
                      <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {formatCurrency(item.product.cost_price)}
                      </p>
                    </div>
                  </div>
                  {hasStock && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 text-center">
                      {showTransferUI ? "Tap to transfer" : "Tap to sell"}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </motion.div>

      {/* Mobile Quick-Sell / Quick-Transfer Sheet */}
      <Sheet
        open={mobileSheetItem !== null}
        onOpenChange={(open) => !open && handleCancel()}
      >
        <SheetContent side="bottom" className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-t-2xl">
          {mobileSheetItem && (
            <>
              <SheetHeader>
                <SheetTitle className="text-zinc-900 dark:text-white">
                  {showTransferUI ? "Quick Transfer" : "Quick Sale"}
                </SheetTitle>
                <SheetDescription className="text-zinc-600 dark:text-zinc-400">
                  {mobileSheetItem.product.name} • {mobileSheetItem.product.brand}
                </SheetDescription>
              </SheetHeader>

              <div className="py-4 space-y-4">
                <div className="flex justify-between items-center p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                  <div>
                    <p className="font-mono text-sm text-zinc-600 dark:text-zinc-400">{mobileSheetItem.product.sku}</p>
                    <p className="text-sm text-zinc-500">
                      Available: <span className="font-medium text-zinc-900 dark:text-white">{mobileSheetItem.quantity_on_hand} units</span>
                    </p>
                  </div>
                  {!showTransferUI && mobileSheetItem.product.retail_price && (
                    <div className="text-right">
                      <p className="text-xs text-zinc-500">Retail</p>
                      <p className="font-medium text-zinc-900 dark:text-white">{formatCurrency(mobileSheetItem.product.retail_price)}</p>
                    </div>
                  )}
                </div>

                {showTransferUI ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Destination Warehouse</label>
                      <Select value={transferDestination} onValueChange={setTransferDestination}>
                        <SelectTrigger className="h-12 bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700">
                          <SelectValue placeholder="Select warehouse" />
                        </SelectTrigger>
                        <SelectContent>
                          {partnerWarehouses.map((wh) => (
                            <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity to Transfer</label>
                      <Input
                        type="number"
                        min="1"
                        max={mobileSheetItem.quantity_on_hand}
                        value={transferQuantity}
                        onChange={(e) => setTransferQuantity(e.target.value)}
                        className="text-lg h-12 bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Note (optional)</label>
                      <Input
                        type="text"
                        value={transferNote}
                        onChange={(e) => setTransferNote(e.target.value)}
                        placeholder="e.g., Transfer to CarProofing"
                        className="bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity to Sell</label>
                      <Input
                        type="number"
                        min="1"
                        max={mobileSheetItem.quantity_on_hand}
                        value={sellQuantity}
                        onChange={(e) => setSellQuantity(e.target.value)}
                        className="text-lg h-12 bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Unit Price</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">PKR</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={sellPrice}
                          onChange={(e) => setSellPrice(e.target.value)}
                          placeholder="0.00"
                          className="text-lg h-12 pl-12 bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                        />
                      </div>
                      {mobileSheetItem.product.cost_price && (
                        <p className="text-xs text-amber-600 dark:text-amber-500">Minimum price (cost): {formatCurrency(mobileSheetItem.product.cost_price)}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Customer / Note <span className="text-red-500">*</span></label>
                      <Input
                        type="text"
                        value={sellNote}
                        onChange={(e) => setSellNote(e.target.value)}
                        placeholder="e.g., John's Auto Shop"
                        className="bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                        required
                      />
                    </div>
                    {sellQuantity && sellPrice && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-blue-700 dark:text-blue-300">Total</span>
                          <span className="text-xl font-bold text-blue-900 dark:text-blue-100">
                            {formatCurrency(parseFloat(sellPrice || "0") * parseInt(sellQuantity || "0", 10))}
                          </span>
                        </div>
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                          Stock after sale: {mobileSheetItem.quantity_on_hand - parseInt(sellQuantity || "0", 10)} units
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              <SheetFooter className="flex-row gap-3">
                <Button variant="outline" onClick={handleCancel} className="flex-1 border-zinc-300 dark:border-zinc-700">
                  Cancel
                </Button>
                {showTransferUI ? (
                  <Button
                    onClick={() => handleTransferSubmit(mobileSheetItem)}
                    disabled={transferMutation.isPending || !transferDestination}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {transferMutation.isPending ? "Processing..." : "Confirm Transfer"}
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleSaleSubmit(mobileSheetItem)}
                    disabled={saleMutation.isPending}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {saleMutation.isPending ? "Processing..." : "Confirm Sale"}
                  </Button>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </motion.div>
  );
}
