import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  createServiceClient,
  requireWarehouseAccess,
} from "@/lib/supabase-server";

interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category?: string;
  image_url?: string;
  retail_price?: number;
  wholesale_price?: number;
  cost_price?: number;
}

interface InventoryItem {
  id: string;
  warehouse_id: string;
  product_id: string;
  quantity_on_hand: number;
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

  // Get query params
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("page_size") || "50", 10);
  const search = searchParams.get("search");
  const brand = searchParams.get("brand");

  // Get warehouse info
  const { data: warehouse, error: warehouseError } = await supabase
    .from("warehouses")
    .select("*")
    .eq("id", warehouseId)
    .single();

  if (warehouseError || !warehouse) {
    return NextResponse.json({ detail: "Warehouse not found" }, { status: 404 });
  }

  // Pre-filter: collect product IDs matching search and/or brand
  let productIds: string[] | null = null;

  if (search) {
    const searchTerm = `%${search}%`;
    const { data: searchData } = await supabase
      .from("products")
      .select("id")
      .or(`sku.ilike.${searchTerm},name.ilike.${searchTerm},brand.ilike.${searchTerm}`);

    productIds = (searchData || []).map((p) => p.id);
  }

  if (brand) {
    const { data: brandData } = await supabase
      .from("products")
      .select("id")
      .eq("brand", brand);

    const brandIds = new Set((brandData || []).map((p) => p.id));

    if (productIds !== null) {
      // Intersect with search results
      productIds = productIds.filter((id) => brandIds.has(id));
    } else {
      productIds = [...brandIds];
    }
  }

  // Return empty if filters matched nothing
  if (productIds !== null && productIds.length === 0) {
    return NextResponse.json({
      warehouse_id: warehouseId,
      warehouse_name: warehouse.name,
      items: [],
      total_items: 0,
      page,
      page_size: pageSize,
      low_stock_count: 0,
    });
  }

  // Base query
  let query = supabase
    .from("inventory_items")
    .select("*, products(*)", { count: "exact" })
    .eq("warehouse_id", warehouseId);

  // Apply product filter if searching
  if (productIds !== null) {
    query = query.in("product_id", productIds);
  }

  // Apply pagination
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;

  const { data: inventoryData, count } = await query.range(start, end);

  // Separate query for low stock count (global for this warehouse)
  const { count: lowStockCount } = await supabase
    .from("inventory_items")
    .select("*", { count: "exact", head: true })
    .eq("warehouse_id", warehouseId)
    .lt("quantity_on_hand", 5);

  const items = (inventoryData as InventoryItem[] || []).map((item) => {
    const product = item.products;
    return {
      id: item.id,
      warehouse_id: item.warehouse_id,
      product_id: item.product_id,
      quantity_on_hand: item.quantity_on_hand,
      product: product
        ? {
            id: product.id,
            sku: product.sku,
            name: product.name,
            brand: product.brand,
            category: product.category || null,
            image_url: product.image_url || null,
            retail_price: product.retail_price || null,
            wholesale_price: product.wholesale_price || null,
            cost_price: product.cost_price || null,
          }
        : null,
    };
  });

  return NextResponse.json({
    warehouse_id: warehouseId,
    warehouse_name: warehouse.name,
    items,
    total_items: count || 0,
    page,
    page_size: pageSize,
    low_stock_count: lowStockCount || 0,
  });
}
