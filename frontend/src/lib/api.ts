/**
 * API client for communicating with Next.js API routes.
 * Uses relative paths - auth handled via cookies (same-origin).
 */

/**
 * Make an API request. Auth is handled via cookies automatically.
 */
async function fetchApi(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  // Use relative URL - same-origin request, cookies sent automatically
  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  return response;
}

/**
 * API helper with typed responses.
 */
export const api = {
  // Auth
  async getMe() {
    const res = await fetchApi("/api/me");
    if (!res.ok) throw new Error("Failed to fetch user profile");
    return res.json();
  },

  // Inventory
  async getInventory(
    warehouseId: string,
    options?: { page?: number; limit?: number; search?: string; brand?: string }
  ) {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", options.page.toString());
    if (options?.limit) params.set("page_size", options.limit.toString());
    if (options?.search) params.set("search", options.search);
    if (options?.brand) params.set("brand", options.brand);

    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchApi(`/api/inventory/${warehouseId}${query}`);
    if (!res.ok) throw new Error("Failed to fetch inventory");
    return res.json();
  },

  async getAllInventory() {
    const res = await fetchApi("/api/inventory");
    if (!res.ok) throw new Error("Failed to fetch inventory");
    return res.json();
  },

  // Warehouses
  async getWarehouses() {
    const res = await fetchApi("/api/warehouses");
    if (!res.ok) throw new Error("Failed to fetch warehouses");
    return res.json();
  },

  async getWarehouse(warehouseId: string) {
    const res = await fetchApi(`/api/warehouses/${warehouseId}`);
    if (!res.ok) throw new Error("Failed to fetch warehouse");
    return res.json();
  },

  // Brands
  async getBrands(): Promise<string[]> {
    const res = await fetchApi("/api/brands");
    if (!res.ok) throw new Error("Failed to fetch brands");
    const data = await res.json();
    return data.brands;
  },

  // Transfers
  async createTransfer(data: {
    from_warehouse_id: string;
    to_warehouse_id: string;
    product_id: string;
    quantity: number;
    reference_note?: string;
  }) {
    const res = await fetchApi("/api/transfers", {
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
    unit_price?: number;
    reference_note?: string;
  }) {
    const res = await fetchApi("/api/sales", {
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
    unit_cost?: number;
    reference_note?: string;
  }) {
    const res = await fetchApi("/api/purchases", {
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
      brand?: string;
      page?: number;
      page_size?: number;
    }
  ) {
    const params = new URLSearchParams();
    if (options?.transaction_type)
      params.set("transaction_type", options.transaction_type);
    if (options?.brand) params.set("brand", options.brand);
    if (options?.page) params.set("page", options.page.toString());
    if (options?.page_size)
      params.set("page_size", options.page_size.toString());

    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchApi(`/api/transactions/${warehouseId}${query}`);
    if (!res.ok) throw new Error("Failed to fetch transactions");
    return res.json();
  },
};
