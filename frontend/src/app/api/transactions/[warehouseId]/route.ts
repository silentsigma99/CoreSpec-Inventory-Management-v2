import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireWarehouseAccess,
} from "@/lib/supabase-server";

const VALID_TRANSACTION_TYPES = [
  "SALE",
  "RESTOCK",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "ADJUSTMENT",
];

interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category?: string;
  retail_price?: number;
}

interface Warehouse {
  id: string;
  name: string;
  manager_id?: string;
}

interface Transaction {
  id: string;
  transaction_type: string;
  product_id: string;
  from_warehouse_id?: string;
  to_warehouse_id?: string;
  quantity: number;
  unit_price?: number;
  reference_note?: string;
  created_by?: string;
  created_at: string;
  products?: Product;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ warehouseId: string }> }
) {
  const { warehouseId } = await params;

  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  // Check access
  const accessError = requireWarehouseAccess(user, warehouseId);
  if (accessError) return accessError;

  const supabase = createServiceClient();

  // Validate warehouse exists
  const { data: warehouse, error: warehouseError } = await supabase
    .from("warehouses")
    .select("id")
    .eq("id", warehouseId)
    .single();

  if (warehouseError || !warehouse) {
    return NextResponse.json({ detail: "Warehouse not found" }, { status: 404 });
  }

  // Get query params
  const searchParams = request.nextUrl.searchParams;
  const transactionType = searchParams.get("transaction_type");
  const excludeInvoiced = searchParams.get("exclude_invoiced") === "true";
  const brand = searchParams.get("brand");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = Math.min(
    parseInt(searchParams.get("page_size") || "50", 10),
    100
  );

  // Validate transaction type if provided
  if (transactionType && !VALID_TRANSACTION_TYPES.includes(transactionType)) {
    return NextResponse.json(
      { detail: `Invalid transaction_type. Must be one of: ${VALID_TRANSACTION_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  // If brand filter is provided, resolve matching product IDs first
  let brandProductIds: string[] | null = null;
  if (brand) {
    const { data: brandData } = await supabase
      .from("products")
      .select("id")
      .eq("brand", brand);

    brandProductIds = (brandData || []).map((p) => p.id);
    if (brandProductIds.length === 0) {
      return NextResponse.json({
        items: [],
        total: 0,
        page,
        page_size: pageSize,
      });
    }
  }

  // Build warehouse filter based on transaction type direction:
  // - TRANSFER_OUT / SALE: warehouse is the source (from_warehouse_id)
  // - TRANSFER_IN / RESTOCK: warehouse is the destination (to_warehouse_id)
  // - ADJUSTMENT: warehouse is the source (from_warehouse_id)
  // - No type filter: show all transactions involving the warehouse in either direction
  // Note: Generic removed to avoid "Type instantiation is excessively deep" with Supabase query builder
  const transactionsBase = supabase.from("transactions").select("*, products(*)");
  let query = !transactionType
    ? transactionsBase.or(`from_warehouse_id.eq.${warehouseId},to_warehouse_id.eq.${warehouseId}`)
    : transactionType === "TRANSFER_OUT" || transactionType === "SALE" || transactionType === "ADJUSTMENT"
      ? transactionsBase.eq("from_warehouse_id", warehouseId)
      : transactionType === "TRANSFER_IN" || transactionType === "RESTOCK"
        ? transactionsBase.eq("to_warehouse_id", warehouseId)
        : transactionsBase.or(`from_warehouse_id.eq.${warehouseId},to_warehouse_id.eq.${warehouseId}`);

  // Filter by type if specified
  if (transactionType) {
    query = query.eq("transaction_type", transactionType);
  }

  // Apply brand filter
  if (brandProductIds !== null) {
    query = query.in("product_id", brandProductIds);
  }

  // Exclude invoice-linked sales when requested (for On-the-Spot tab)
  if (transactionType === "SALE" && excludeInvoiced) {
    query = query.is("invoice_id", null);
  }

  // Get total count (mirrors all filters)
  const countBase = supabase.from("transactions").select("id", { count: "exact" });
  let countQuery = !transactionType
    ? countBase.or(`from_warehouse_id.eq.${warehouseId},to_warehouse_id.eq.${warehouseId}`)
    : transactionType === "TRANSFER_OUT" || transactionType === "SALE" || transactionType === "ADJUSTMENT"
      ? countBase.eq("from_warehouse_id", warehouseId)
      : transactionType === "TRANSFER_IN" || transactionType === "RESTOCK"
        ? countBase.eq("to_warehouse_id", warehouseId)
        : countBase.or(`from_warehouse_id.eq.${warehouseId},to_warehouse_id.eq.${warehouseId}`);

  if (transactionType) {
    countQuery = countQuery.eq("transaction_type", transactionType);
  }

  if (brandProductIds !== null) {
    countQuery = countQuery.in("product_id", brandProductIds);
  }

  if (transactionType === "SALE" && excludeInvoiced) {
    countQuery = countQuery.is("invoice_id", null);
  }

  const { count: total } = await countQuery;

  // Apply pagination and ordering
  const offset = (page - 1) * pageSize;
  query = query.order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);

  const { data: transactions } = await query;

  // Cache warehouse names
  const warehouseCache: Record<string, Warehouse | null> = {};

  async function getWarehouse(wid: string | undefined): Promise<Warehouse | null> {
    if (!wid) return null;
    if (wid in warehouseCache) return warehouseCache[wid];

    const { data } = await supabase
      .from("warehouses")
      .select("*")
      .eq("id", wid)
      .single();

    if (data) {
      warehouseCache[wid] = {
        id: data.id,
        name: data.name,
        manager_id: data.manager_id || undefined,
      };
    } else {
      warehouseCache[wid] = null;
    }
    return warehouseCache[wid];
  }

  const items = [];
  for (const t of (transactions as Transaction[]) || []) {
    const product = t.products;
    const fromWarehouse = await getWarehouse(t.from_warehouse_id);
    const toWarehouse = await getWarehouse(t.to_warehouse_id);

    items.push({
      id: t.id,
      transaction_type: t.transaction_type,
      product_id: t.product_id,
      from_warehouse_id: t.from_warehouse_id || null,
      to_warehouse_id: t.to_warehouse_id || null,
      quantity: t.quantity,
      unit_price: t.unit_price || null,
      reference_note: t.reference_note || null,
      created_by: t.created_by || null,
      created_at: t.created_at,
      product: product
        ? {
            id: product.id,
            sku: product.sku,
            name: product.name,
            brand: product.brand,
            category: product.category || null,
            retail_price: product.retail_price || null,
          }
        : null,
      from_warehouse: fromWarehouse
        ? {
            id: fromWarehouse.id,
            name: fromWarehouse.name,
            manager_id: fromWarehouse.manager_id || null,
          }
        : null,
      to_warehouse: toWarehouse
        ? {
            id: toWarehouse.id,
            name: toWarehouse.name,
            manager_id: toWarehouse.manager_id || null,
          }
        : null,
    });
  }

  return NextResponse.json({
    items,
    total: total || 0,
    page,
    page_size: pageSize,
  });
}
