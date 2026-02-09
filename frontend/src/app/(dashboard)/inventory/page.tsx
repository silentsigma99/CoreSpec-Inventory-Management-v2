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
import { ChevronDown, ChevronRight, ChevronLeft, Download } from "lucide-react";
import { exportInventoryPDF, type PDFInventoryItem } from "@/lib/pdf-export";

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
  const { profile, isAdmin, isViewer } = useAuth();
  const queryClient = useQueryClient();
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [brand, setBrand] = useState<string>("all");
  const [sort, setSort] = useState<string>("default");
  const [pageSize, setPageSize] = useState(50);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1); // Reset to page 1 on search
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset to page 1 when brand, sort, or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [brand, sort, pageSize]);

  // Clear transfer selection when switching warehouses
  useEffect(() => {
    setSelectedItems({});
  }, [selectedWarehouse]);

  // Quick-sell state (Partner warehouses)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [sellQuantity, setSellQuantity] = useState<string>("1");
  const [sellPrice, setSellPrice] = useState<string>("");
  const [sellNote, setSellNote] = useState<string>("");

  // Bulk transfer state (Main Warehouse only)
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [transferDestination, setTransferDestination] = useState<string>("");
  const [transferNote, setTransferNote] = useState<string>("");

  // Fetch warehouses (for admin dropdown)
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () => api.getWarehouses(),
    enabled: isAdmin || isViewer,
  });

  const selectedWarehouseData = warehouses?.find((w) => w.id === selectedWarehouse);
  const isMainWarehouse = selectedWarehouseData?.is_main === true;
  const showTransferUI = isAdmin;
  const canSell = !isViewer;
  const transferDestinations = useMemo(
    () => warehouses?.filter((w) => w.id !== selectedWarehouse) ?? [],
    [warehouses, selectedWarehouse]
  );

  // Set default warehouse
  useEffect(() => {
    if (profile?.warehouse_id && !selectedWarehouse) {
      setSelectedWarehouse(profile.warehouse_id);
    } else if ((isAdmin || isViewer) && warehouses?.length && !selectedWarehouse) {
      const mainWarehouse = warehouses.find((wh) => wh.is_main) ?? warehouses.find((wh) => wh.name === "Main Warehouse");
      setSelectedWarehouse(mainWarehouse?.id || warehouses[0].id);
    }
  }, [profile, isAdmin, isViewer, warehouses, selectedWarehouse]);

  // Set default transfer destination when warehouses load or selected warehouse changes
  useEffect(() => {
    if (showTransferUI && transferDestinations.length > 0) {
      const isValid = transferDestinations.some((w) => w.id === transferDestination);
      if (!isValid) {
        setTransferDestination(transferDestinations[0].id);
      }
    }
  }, [showTransferUI, transferDestinations, transferDestination]);

  // Fetch inventory for selected warehouse
  const {
    data: inventory,
    isLoading,
    error,
  } = useQuery<InventoryResponse>({
    queryKey: ["inventory", selectedWarehouse, currentPage, debouncedSearch, brand, sort, pageSize],
    queryFn: () => api.getInventory(selectedWarehouse, {
      page: currentPage,
      limit: pageSize,
      search: debouncedSearch,
      brand: brand === "all" ? undefined : brand,
      sort: sort === "default" ? undefined : (sort as "quantity_asc" | "quantity_desc"),
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
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to record sale");
    },
  });

  // Bulk transfer mutation (Main Warehouse)
  const bulkTransferMutation = useMutation({
    mutationFn: (data: {
      from_warehouse_id: string;
      to_warehouse_id: string;
      items: { product_id: string; quantity: number }[];
      reference_note?: string;
    }) => api.createBulkTransfer(data),
    onSuccess: (data: { succeeded: number; failed: number; total: number; results: { product_id: string; success: boolean; error?: string }[] }) => {
      if (data.failed === 0) {
        toast.success(`Successfully transferred ${data.succeeded} items`);
      } else if (data.succeeded > 0) {
        const failedProducts = data.results.filter((r) => !r.success).map((r) => r.error || "Unknown error").join("; ");
        toast.warning(`${data.succeeded} of ${data.total} transferred. Failed: ${failedProducts}`);
      } else {
        toast.error("All transfers failed");
      }
      setSelectedItems({});
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

  const handleRowClick = (item: InventoryItem) => {
    if (!canSell) return; // Viewers cannot sell
    if (showTransferUI && isMainWarehouse) return; // Main Warehouse: no expand, use checkboxes
    if (item.quantity_on_hand <= 0) {
      toast.error("No stock available to sell");
      return;
    }
    if (expandedRowId === item.id) {
      setExpandedRowId(null);
      resetSellForm();
    } else {
      setSellPrice(item.product.retail_price?.toString() || "");
      setSellQuantity("1");
      setSellNote("");
      setExpandedRowId(item.id);
    }
  };

  const handleTransferCheckboxChange = (item: InventoryItem, checked: boolean) => {
    if (checked) {
      setSelectedItems((prev) => ({ ...prev, [item.product_id]: 1 }));
    } else {
      setSelectedItems((prev) => {
        const next = { ...prev };
        delete next[item.product_id];
        return next;
      });
    }
  };

  const handleTransferQuantityChange = (productId: string, value: string) => {
    const qty = parseInt(value, 10);
    if (isNaN(qty) || qty < 1) return;
    setSelectedItems((prev) => ({ ...prev, [productId]: qty }));
  };

  const handleSelectAll = (items: InventoryItem[]) => {
    const withStock = items.filter((i) => i.quantity_on_hand > 0);
    const allSelected = withStock.every((i) => selectedItems[i.product_id]);
    if (allSelected) {
      setSelectedItems((prev) => {
        const next = { ...prev };
        withStock.forEach((i) => delete next[i.product_id]);
        return next;
      });
    } else {
      setSelectedItems((prev) => {
        const next = { ...prev };
        withStock.forEach((i) => (next[i.product_id] = next[i.product_id] ?? 1));
        return next;
      });
    }
  };

  const handleBulkTransferSubmit = () => {
    if (!transferDestination) {
      toast.error("Please select a destination warehouse");
      return;
    }
    const items = Object.entries(selectedItems)
      .filter(([, qty]) => qty > 0)
      .map(([product_id, quantity]) => ({ product_id, quantity }));
    if (items.length === 0) {
      toast.error("No items selected");
      return;
    }
    bulkTransferMutation.mutate({
      from_warehouse_id: selectedWarehouse,
      to_warehouse_id: transferDestination,
      items,
      reference_note: transferNote.trim() || undefined,
    });
  };

  const clearTransferSelection = () => setSelectedItems({});

  // PDF Export
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = async () => {
    if (!selectedWarehouse) return;

    setIsExporting(true);
    const toastId = toast.loading("Generating PDF...");
    try {
      const allData = await api.getInventory(selectedWarehouse, { limit: 10000 });
      const warehouseName = selectedWarehouseData?.name
        ?? warehouses?.find((w) => w.id === selectedWarehouse)?.name
        ?? "Warehouse";

      const pdfItems: PDFInventoryItem[] = allData.items.map((item: InventoryItem) => ({
        productName: item.product.name,
        sku: item.product.sku,
        brand: item.product.brand,
        quantity: item.quantity_on_hand,
        retailPrice: item.product.retail_price,
        wholesalePrice: item.product.wholesale_price,
        costPrice: item.product.cost_price,
      }));

      await exportInventoryPDF({
        warehouseName,
        items: pdfItems,
      });

      toast.success("PDF exported successfully", { id: toastId });
    } catch {
      toast.error("Failed to export PDF", { id: toastId });
    } finally {
      setIsExporting(false);
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
    resetSellForm();
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

  const selectedCount = Object.keys(selectedItems).length;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={`space-y-6 ${showTransferUI && selectedCount > 0 ? "pb-24" : ""}`}
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
          {/* Export PDF */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPDF}
            disabled={isLoading || isExporting || !selectedWarehouse}
            className="border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
          >
            <Download className="h-4 w-4 mr-1" />
            {isExporting ? "Exporting..." : "Export PDF"}
          </Button>

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

          {/* Sort by quantity */}
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-full sm:w-[180px] border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="quantity_asc">Quantity: Low to High</SelectItem>
              <SelectItem value="quantity_desc">Quantity: High to Low</SelectItem>
            </SelectContent>
          </Select>

          {/* Rows per page */}
          <Select
            value={pageSize.toString()}
            onValueChange={(val) => setPageSize(parseInt(val, 10))}
          >
            <SelectTrigger className="w-full sm:w-[140px] border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white">
              <SelectValue placeholder="Rows per page" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 per page</SelectItem>
              <SelectItem value="100">100 per page</SelectItem>
              <SelectItem value="200">200 per page</SelectItem>
            </SelectContent>
          </Select>

          {/* Warehouse selector (admin only) */}
          {(isAdmin || isViewer) && warehouses && (
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

      {/* Table View (all breakpoints) */}
      <motion.div variants={itemVariants}>
        <Card className="bg-white dark:bg-zinc-900 border-black dark:border-zinc-800 p-6 shadow-sm ring-1 ring-black/5 dark:ring-[#B8860B] overflow-hidden">
          <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow className="border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50">
                {showTransferUI ? (
                  <TableHead className="text-zinc-600 dark:text-zinc-400 w-10">
                    <input
                      type="checkbox"
                      checked={inventory?.items?.length
                        ? inventory.items.filter((i) => i.quantity_on_hand > 0).length > 0 &&
                          inventory.items.filter((i) => i.quantity_on_hand > 0).every((i) => selectedItems[i.product_id])
                        : false}
                      onChange={() => inventory && handleSelectAll(inventory.items)}
                      className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                    />
                  </TableHead>
                ) : (
                  <TableHead className="text-zinc-600 dark:text-zinc-400 w-8"></TableHead>
                )}
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Quantity
                </TableHead>
                {showTransferUI && (
                  <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                    Transfer
                  </TableHead>
                )}
                <TableHead className="text-zinc-600 dark:text-zinc-400">Product</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Retail Price
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Wholesale Price
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400 text-right">
                  Cost Price
                </TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Brand</TableHead>
                <TableHead className="text-zinc-600 dark:text-zinc-400">Product Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-200 dark:border-zinc-800">
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                    {showTransferUI && <TableCell><Skeleton className="h-4 w-12" /></TableCell>}
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : inventory?.items.length === 0 ? (
                <TableRow className="border-zinc-200 dark:border-zinc-800">
                  <TableCell
                    colSpan={showTransferUI ? 9 : 8}
                    className="text-center text-zinc-500 py-8"
                  >
                    No inventory items found
                  </TableCell>
                </TableRow>
              ) : (
                inventory?.items.map((item) => {
                  const isExpanded = expandedRowId === item.id;
                  const hasStock = item.quantity_on_hand > 0;
                  const isSelected = !!selectedItems[item.product_id];
                  const transferQty = selectedItems[item.product_id] ?? 1;

                  return (
                    <Fragment key={item.id}>
                      <TableRow
                        className={`border-zinc-200 dark:border-zinc-800 transition-colors ${hasStock && canSell && !(showTransferUI && isMainWarehouse)
                          ? "cursor-pointer hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50"
                          : ""
                          } ${!hasStock ? "opacity-60" : ""} ${isExpanded ? "bg-zinc-100/50 dark:bg-zinc-800/50" : ""}`}
                        onClick={() => canSell && !(showTransferUI && isMainWarehouse) && hasStock && handleRowClick(item)}
                      >
                        {showTransferUI ? (
                          <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                            {hasStock && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => handleTransferCheckboxChange(item, e.target.checked)}
                                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                              />
                            )}
                          </TableCell>
                        ) : (
                          <TableCell className="w-8">
                            {hasStock && canSell && (
                              isExpanded
                                ? <ChevronDown className="h-4 w-4 text-zinc-500" />
                                : <ChevronRight className="h-4 w-4 text-zinc-500" />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          {item.quantity_on_hand < 5 ? (
                            <Badge variant="destructive">
                              {item.quantity_on_hand}
                            </Badge>
                          ) : (
                            <span className="text-zinc-900 dark:text-white">{item.quantity_on_hand}</span>
                          )}
                        </TableCell>
                        {showTransferUI && (
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            {hasStock && isSelected ? (
                              <Input
                                type="number"
                                min={1}
                                max={item.quantity_on_hand}
                                value={transferQty}
                                onChange={(e) => handleTransferQuantityChange(item.product_id, e.target.value)}
                                className="w-16 h-8 text-center bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                              />
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="font-medium text-zinc-900 dark:text-white">
                          {item.product.name}
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
                        <TableCell className="text-zinc-500 dark:text-zinc-400">
                          {item.product.brand}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-zinc-600 dark:text-zinc-300">
                          {item.product.sku}
                        </TableCell>
                      </TableRow>

                      {/* Expanded row: Sale only (Partner warehouses) */}
                      {!isMainWarehouse && (
                        <AnimatePresence>
                          {isExpanded && (
                            <TableRow
                              key={`${item.id}-expand`}
                              className="border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 shadow-inner"
                            >
                              <TableCell colSpan={showTransferUI ? 9 : 8} className="p-0">
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.3, ease: "easeInOut" }}
                                  className="overflow-hidden"
                                >
                                  <div className="p-4 sm:p-6">
                                    <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
                                      <div className="grid grid-cols-2 sm:flex sm:flex-row gap-3 sm:gap-4">
                                        <div className="space-y-2">
                                          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block">Quantity</label>
                                          <Input
                                            type="number"
                                            min="1"
                                            max={item.quantity_on_hand}
                                            value={sellQuantity}
                                            onChange={(e) => setSellQuantity(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full sm:w-20 bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
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
                                              className="w-full sm:w-28 pl-10 bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                            />
                                          </div>
                                          {sellPrice && item.product.cost_price != null && (() => {
                                            const unitProfit = parseFloat(sellPrice) - item.product.cost_price;
                                            const qty = parseInt(sellQuantity || "0", 10);
                                            const totalProfit = unitProfit * (isNaN(qty) ? 0 : qty);
                                            const colorClass = unitProfit > 0
                                              ? "text-green-600 dark:text-green-400"
                                              : unitProfit < 0
                                                ? "text-red-600 dark:text-red-400"
                                                : "text-zinc-500";
                                            return (
                                              <p className={`text-[10px] pl-1 ${colorClass}`}>
                                                Profit: {formatCurrency(unitProfit)}/unit ({formatCurrency(totalProfit)} total)
                                              </p>
                                            );
                                          })()}
                                        </div>
                                      </div>
                                      <div className="space-y-2">
                                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block">Customer / Note <span className="text-red-500">*</span></label>
                                        <Input
                                          type="text"
                                          value={sellNote}
                                          onChange={(e) => setSellNote(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          placeholder="e.g., John's Auto Shop"
                                          className="w-full sm:w-[140px] bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                          required
                                        />
                                      </div>
                                      <div className="flex gap-3 pt-2 sm:pt-6">
                                        <Button variant="outline" onClick={(e) => { e.stopPropagation(); handleCancel(); }} className="flex-1 sm:flex-none border-zinc-300 dark:border-zinc-700">
                                          Cancel
                                        </Button>
                                        <Button
                                          onClick={(e) => { e.stopPropagation(); handleSaleSubmit(item); }}
                                          disabled={saleMutation.isPending}
                                          className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 text-white sm:min-w-[120px]"
                                        >
                                          {saleMutation.isPending ? "Processing..." : "Confirm Sale"}
                                        </Button>
                                      </div>
                                    </div>
                                    {sellQuantity && sellPrice && (
                                      <div className="mt-4 pt-4 border-t border-zinc-200/60 dark:border-zinc-700/60 flex flex-col sm:flex-row gap-2 sm:gap-6 text-sm">
                                        <p className="text-zinc-600 dark:text-zinc-400">
                                          Total: <span className="font-semibold text-zinc-900 dark:text-white">{formatCurrency(parseFloat(sellPrice || "0") * parseInt(sellQuantity || "0", 10))}</span>
                                        </p>
                                        {item.product.cost_price != null && (() => {
                                          const qty = parseInt(sellQuantity || "0", 10);
                                          const totalProfit = (parseFloat(sellPrice) - item.product.cost_price) * (isNaN(qty) ? 0 : qty);
                                          const colorClass = totalProfit > 0
                                            ? "text-green-600 dark:text-green-400"
                                            : totalProfit < 0
                                              ? "text-red-600 dark:text-red-400"
                                              : "text-zinc-600 dark:text-zinc-400";
                                          return (
                                            <p className={colorClass}>
                                              Profit: <span className="font-semibold">{formatCurrency(totalProfit)}</span>
                                            </p>
                                          );
                                        })()}
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
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>

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

      {/* Sticky Bulk Transfer Toolbar (Main Warehouse only) */}
      {showTransferUI && Object.keys(selectedItems).length > 0 && (
        <motion.div
          variants={itemVariants}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-4"
        >
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {Object.keys(selectedItems).length} item{Object.keys(selectedItems).length !== 1 ? "s" : ""} selected
            </span>
            <div className="flex-1 flex flex-col sm:flex-row gap-3">
              <Select value={transferDestination} onValueChange={setTransferDestination}>
                <SelectTrigger className="w-full sm:w-[180px] bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700">
                  <SelectValue placeholder="Destination warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {transferDestinations.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="text"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="Note (optional)"
                className="flex-1 min-w-0 bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={clearTransferSelection}
                className="border-zinc-300 dark:border-zinc-700"
              >
                Clear Selection
              </Button>
              <Button
                onClick={handleBulkTransferSubmit}
                disabled={bulkTransferMutation.isPending || !transferDestination}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {bulkTransferMutation.isPending ? "Transferring..." : `Transfer ${Object.keys(selectedItems).length} Items`}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
