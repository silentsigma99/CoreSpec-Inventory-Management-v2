"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * Subscribes to inventory_items Postgres changes via Supabase Realtime.
 * Invalidates TanStack Query cache when inventory changes, enabling cross-tab sync.
 * Only runs when user is authenticated. Cleans up on unmount.
 */
export function useInventoryRealtime() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;

    try {
      const supabase = getSupabaseClient();
      const channel = supabase
        .channel("cis-inventory-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "inventory_items",
          },
          (payload) => {
            const newRecord = payload.new as { warehouse_id?: string } | null;
            const oldRecord = payload.old as { warehouse_id?: string } | null;
            const warehouseId = newRecord?.warehouse_id ?? oldRecord?.warehouse_id;
            if (warehouseId) {
              queryClient.invalidateQueries({
                queryKey: ["inventory", warehouseId],
              });
            }
          }
        )
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" && err) {
            console.warn("[Inventory Realtime]", err);
          }
        });

      return () => {
        supabase.removeChannel(channel);
      };
    } catch (err) {
      console.warn("[Inventory Realtime] Setup failed:", err);
    }
  }, [user, queryClient]);
}
