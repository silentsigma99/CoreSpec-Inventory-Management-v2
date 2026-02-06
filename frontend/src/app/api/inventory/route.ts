import { NextResponse } from "next/server";
import { getUserFromRequest, createServiceClient } from "@/lib/supabase-server";

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

interface Warehouse {
  id: string;
  name: string;
}

export async function GET() {
  const { user, error } = await getUserFromRequest();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get warehouses user has access to
  let warehousesQuery = supabase.from("warehouses").select("*");

  if (user.role !== "admin" && user.role !== "viewer") {
    if (!user.warehouseId) {
      return NextResponse.json([]);
    }
    warehousesQuery = warehousesQuery.eq("id", user.warehouseId);
  }

  const { data: warehouses } = await warehousesQuery;

  const results = [];

  for (const warehouse of (warehouses as Warehouse[]) || []) {
    // Get inventory for this warehouse
    const { data: inventoryData } = await supabase
      .from("inventory_items")
      .select("*, products(*)")
      .eq("warehouse_id", warehouse.id);

    let lowStockCount = 0;
    const items = ((inventoryData as InventoryItem[]) || []).map((item) => {
      if (item.quantity_on_hand < 5) {
        lowStockCount++;
      }

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

    results.push({
      warehouse_id: warehouse.id,
      warehouse_name: warehouse.name,
      items,
      total_items: items.length,
      low_stock_count: lowStockCount,
    });
  }

  return NextResponse.json(results);
}
