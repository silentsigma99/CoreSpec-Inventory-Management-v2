-- CoreSpec Inventory System - Seed Data
-- Run this AFTER 001_initial_schema.sql and 002_row_level_security.sql
-- and AFTER creating users in Supabase Auth

-- ============================================
-- INSTRUCTIONS
-- ============================================
-- 1. First, create users in Supabase Auth Dashboard:
--    - admin@corespec.com (admin user)
--    - partner1@corespec.com (CarProofing manager)
--    - partner2@corespec.com (Delta Sonic manager)
--
-- 2. Get their UUIDs from auth.users table
--
-- 3. Replace the placeholder UUIDs below with real ones
--
-- 4. Run this seed script
-- ============================================

-- ============================================
-- PRODUCTS (Car Detailing Products)
-- ============================================

INSERT INTO products (sku, name, brand, category, retail_price) VALUES
    -- Chemical Guys Products
    ('CG-VRP-16', 'VRP Vinyl Rubber Plastic Dressing', 'Chemical Guys', 'Interior', 19.99),
    ('CG-CWS-16', 'Citrus Wash & Gloss', 'Chemical Guys', 'Wash', 17.99),
    ('CG-JC-16', 'JetSeal Sealant', 'Chemical Guys', 'Protection', 34.99),
    ('CG-INS-16', 'InnerClean Interior Detailer', 'Chemical Guys', 'Interior', 14.99),
    ('CG-VSS-16', 'V07 Spray Sealant', 'Chemical Guys', 'Protection', 21.99),
    
    -- CarPro Products  
    ('CP-RELOAD-500', 'Reload Spray Sealant', 'CarPro', 'Protection', 29.99),
    ('CP-ETCH-500', 'Eraser Intensive Polish', 'CarPro', 'Polish', 24.99),
    ('CP-IRON-500', 'Iron X Iron Remover', 'CarPro', 'Decontamination', 22.99),
    ('CP-PERL-500', 'Perl Plastic & Rubber Protectant', 'CarPro', 'Interior', 19.99),
    
    -- Nanoskin Products
    ('NS-CLAY-FINE', 'AutoScrub Fine Grade Clay Mitt', 'Nanoskin', 'Decontamination', 34.99),
    ('NS-CLAY-MED', 'AutoScrub Medium Grade Clay Mitt', 'Nanoskin', 'Decontamination', 34.99),
    
    -- Gyeon Products
    ('GY-WETCOAT-500', 'WetCoat Hydrophobic Coating', 'Gyeon', 'Protection', 24.99),
    ('GY-CURE-250', 'Cure Silica Spray', 'Gyeon', 'Protection', 29.99),
    
    -- Meguiars Products
    ('MG-D101-128', 'All Purpose Cleaner D101', 'Meguiars', 'Interior', 24.99),
    ('MG-M105-32', 'Ultra Cut Compound M105', 'Meguiars', 'Polish', 44.99);

-- ============================================
-- WAREHOUSES
-- ============================================

-- Main warehouse (no manager - admin managed)
INSERT INTO warehouses (id, name, manager_id) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Main Warehouse', NULL);

-- Partner warehouses (manager_id will be updated after users are created)
INSERT INTO warehouses (id, name, manager_id) VALUES
    ('00000000-0000-0000-0000-000000000002', 'CarProofing', NULL),
    ('00000000-0000-0000-0000-000000000003', 'Delta Sonic', NULL);

-- ============================================
-- INITIAL INVENTORY (Main Warehouse)
-- ============================================

INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand)
SELECT 
    '00000000-0000-0000-0000-000000000001'::uuid,
    id,
    -- Random initial stock between 20-100
    FLOOR(RANDOM() * 80 + 20)::int
FROM products;

-- ============================================
-- INITIAL INVENTORY (CarProofing - some products)
-- ============================================

INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand)
SELECT 
    '00000000-0000-0000-0000-000000000002'::uuid,
    id,
    -- Random stock between 5-25
    FLOOR(RANDOM() * 20 + 5)::int
FROM products
WHERE brand IN ('Chemical Guys', 'CarPro')
LIMIT 8;

-- ============================================
-- INITIAL INVENTORY (Delta Sonic - some products)
-- ============================================

INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand)
SELECT 
    '00000000-0000-0000-0000-000000000003'::uuid,
    id,
    -- Random stock between 5-25
    FLOOR(RANDOM() * 20 + 5)::int
FROM products
WHERE brand IN ('CarPro', 'Gyeon', 'Meguiars')
LIMIT 6;

-- ============================================
-- SAMPLE TRANSACTIONS (Audit Trail)
-- ============================================

-- Note: These are example transactions. In production, transactions
-- are created automatically when stock moves happen via the API.

-- Example: Initial restock at main warehouse
INSERT INTO transactions (transaction_type, product_id, to_warehouse_id, quantity, reference_note)
SELECT 
    'RESTOCK',
    id,
    '00000000-0000-0000-0000-000000000001'::uuid,
    50,
    'Initial inventory setup'
FROM products
LIMIT 5;

-- ============================================
-- POST-SETUP: Link Partners to Warehouses
-- ============================================

-- After creating users, run these updates (replace UUIDs):
-- 
-- UPDATE profiles SET role = 'admin', full_name = 'Admin User' WHERE id = 'ADMIN-UUID';
-- UPDATE warehouses SET manager_id = 'PARTNER1-UUID' WHERE id = '00000000-0000-0000-0000-000000000002';
-- UPDATE warehouses SET manager_id = 'PARTNER2-UUID' WHERE id = '00000000-0000-0000-0000-000000000003';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check products were created
-- SELECT COUNT(*) as product_count FROM products;

-- Check inventory levels
-- SELECT w.name, COUNT(i.id) as items, SUM(i.quantity_on_hand) as total_stock
-- FROM warehouses w
-- LEFT JOIN inventory_items i ON w.id = i.warehouse_id
-- GROUP BY w.id, w.name;

-- Check transactions
-- SELECT COUNT(*) as transaction_count FROM transactions;
