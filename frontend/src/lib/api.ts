/**
 * API client for communicating with the FastAPI backend.
 */

import { getSupabaseClient } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Make an authenticated API request.
 */
async function fetchWithAuth(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (session?.access_token) {
    (headers as Record<string, string>)["Authorization"] =
      `Bearer ${session.access_token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  return response;
}

/**
 * API helper with typed responses.
 */
export const api = {
  // Auth
  async getMe() {
    const res = await fetchWithAuth("/api/me");
    if (!res.ok) throw new Error("Failed to fetch user profile");
    return res.json();
  },

  // Inventory
  async getInventory(
    warehouseId: string,
    options?: { page?: number; limit?: number; search?: string }
  ) {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", options.page.toString());
    if (options?.limit) params.set("page_size", options.limit.toString());
    if (options?.search) params.set("search", options.search);

    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchWithAuth(`/api/inventory/${warehouseId}${query}`);
    if (!res.ok) throw new Error("Failed to fetch inventory");
    return res.json();
  },

  async getAllInventory() {
    const res = await fetchWithAuth("/api/inventory/");
    if (!res.ok) throw new Error("Failed to fetch inventory");
    return res.json();
  },

  // Warehouses
  async getWarehouses() {
    const res = await fetchWithAuth("/api/warehouses/");
    if (!res.ok) throw new Error("Failed to fetch warehouses");
    return res.json();
  },

  async getWarehouse(warehouseId: string) {
    const res = await fetchWithAuth(`/api/warehouses/${warehouseId}`);
    if (!res.ok) throw new Error("Failed to fetch warehouse");
    return res.json();
  },

  // Transfers
  async createTransfer(data: {
    from_warehouse_id: string;
    to_warehouse_id: string;
    product_id: string;
    quantity: number;
    reference_note?: string;
  }) {
    const res = await fetchWithAuth("/api/transfers/", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Failed to create transfer");
    }
    return res.json();
  },

  // Sales
  async recordSale(data: {
    warehouse_id: string;
    product_id: string;
    quantity: number;
    unit_price?: number;  // Optional: actual sale price (defaults to retail_price)
    reference_note?: string;
  }) {
    const res = await fetchWithAuth("/api/sales/", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Failed to record sale");
    }
    return res.json();
  },

  // Purchases
  async recordPurchase(data: {
    warehouse_id: string;
    product_id: string;
    quantity: number;
    unit_cost?: number;  // Optional: cost per unit (defaults to product cost_price)
    reference_note?: string;
  }) {
    const res = await fetchWithAuth("/api/purchases/", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Failed to record purchase");
    }
    return res.json();
  },

  // Transactions
  async getTransactions(
    warehouseId: string,
    options?: {
      transaction_type?: string;
      page?: number;
      page_size?: number;
    }
  ) {
    const params = new URLSearchParams();
    if (options?.transaction_type)
      params.set("transaction_type", options.transaction_type);
    if (options?.page) params.set("page", options.page.toString());
    if (options?.page_size)
      params.set("page_size", options.page_size.toString());

    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchWithAuth(`/api/transactions/${warehouseId}${query}`);
    if (!res.ok) throw new Error("Failed to fetch transactions");
    return res.json();
  },
};
