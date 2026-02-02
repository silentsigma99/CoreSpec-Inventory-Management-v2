-- CoreSpec Inventory System - Sale Price Migration
-- Adds unit_price tracking for sales to support on-the-spot pricing
-- 
-- Changes:
--   1. Add cost_price to products (enables margin protection)
--   2. Add unit_price to transactions (captures actual sale price)
--   3. Backfill existing SALE transactions with retail_price

-- ============================================
-- ADD COST PRICE TO PRODUCTS
-- ============================================
-- Cost price enables margin protection validation
-- Nullable since existing products won't have this value

ALTER TABLE products
ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2);

COMMENT ON COLUMN products.cost_price IS 'Product cost/purchase price for margin calculations';

-- ============================================
-- ADD UNIT PRICE TO TRANSACTIONS
-- ============================================
-- Stores the actual sale price at time of transaction
-- Only relevant for SALE transactions; null for others

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10, 2);

COMMENT ON COLUMN transactions.unit_price IS 'Unit price at time of sale (for SALE transactions only)';

-- ============================================
-- BACKFILL EXISTING SALE TRANSACTIONS
-- ============================================
-- Set unit_price to product's current retail_price for historical sales
-- This provides best-effort historical data (actual prices may have differed)

UPDATE transactions t
SET unit_price = p.retail_price
FROM products p
WHERE t.product_id = p.id
  AND t.transaction_type = 'SALE'
  AND t.unit_price IS NULL
  AND p.retail_price IS NOT NULL;

-- ============================================
-- INDEX FOR SALES REPORTING
-- ============================================
-- Useful for revenue queries filtering by transaction type

CREATE INDEX IF NOT EXISTS idx_transactions_type_price 
ON transactions(transaction_type, unit_price) 
WHERE transaction_type = 'SALE';
