-- CoreSpec Inventory System - Wholesale Price Migration
-- Adds wholesale_price to products for multi-tier pricing display
-- 
-- Changes:
--   1. Add wholesale_price to products table
--   2. Enables display of Retail | Wholesale | Cost pricing columns

-- ============================================
-- ADD WHOLESALE PRICE TO PRODUCTS
-- ============================================
-- Wholesale price for B2B/reseller pricing tier
-- Nullable since existing products won't have this value initially

ALTER TABLE products
ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(10, 2);

COMMENT ON COLUMN products.wholesale_price IS 'Wholesale/B2B price for reseller pricing tier';

-- ============================================
-- INDEX FOR PRICE QUERIES (Optional)
-- ============================================
-- Useful if filtering/sorting by wholesale price becomes common

CREATE INDEX IF NOT EXISTS idx_products_wholesale_price 
ON products(wholesale_price) 
WHERE wholesale_price IS NOT NULL;
