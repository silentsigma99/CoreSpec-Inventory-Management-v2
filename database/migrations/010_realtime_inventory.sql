-- Add inventory_items to Realtime publication for cross-tab sync
-- Docs: https://supabase.com/docs/guides/realtime/postgres-changes
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_items;
