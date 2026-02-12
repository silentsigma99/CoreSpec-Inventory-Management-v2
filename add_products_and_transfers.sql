-- ============================================
-- Add Three New Products and Create Transfers
-- ============================================
-- Products: Kenco SPA Towel, Turtle Microfiber, Kenco Microfiber
-- Initial stock in Main Warehouse, then transfers to CarProofing and Delta Sonic
--
-- INSTRUCTIONS:
-- 1. Run this script in Supabase SQL Editor
-- 2. Verify results using queries at the bottom
--
-- PRODUCT DETAILS:
-- - Turtle Microfiber: 20 pieces @ Rs.200 (Cost: Rs.150) → 20 to CarProofing
-- - Kenco SPA Towel: 6 pieces @ Rs.100 (Cost: Rs.93) → 6 to CarProofing
-- - Kenco Microfiber: 60 pieces @ Rs.100 (Cost: Rs.90) → 50 to CarProofing, 10 to Delta Sonic
-- ============================================

BEGIN;

-- ============================================
-- STEP 1: Insert New Products (skip if already exist)
-- ============================================
WITH new_products AS (
    INSERT INTO products (sku, name, brand, category, retail_price, cost_price) VALUES
        ('KC-SPA-TOWEL', 'Kenco SPA Towel', 'Kenco', 'Accessories', 100.00, 93.00),
        ('TR-MICROFIBER', 'Turtle Microfiber', 'Turtle', 'Accessories', 200.00, 150.00),
        ('KC-MICROFIBER', 'Kenco Microfiber', 'Kenco', 'Accessories', 100.00, 90.00)
    ON CONFLICT (sku) DO NOTHING
    RETURNING id, sku, name
)
SELECT * FROM new_products;

-- ============================================
-- STEP 2: Create Initial Inventory in Main Warehouse
-- ============================================
WITH product_ids AS (
    SELECT id, sku FROM products 
    WHERE sku IN ('KC-SPA-TOWEL', 'TR-MICROFIBER', 'KC-MICROFIBER')
),
main_warehouse_id AS (
    SELECT '00000000-0000-0000-0000-000000000001'::uuid AS id
),
inventory_inserts AS (
    INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand)
    SELECT 
        mw.id,
        p.id,
        CASE 
            WHEN p.sku = 'KC-SPA-TOWEL' THEN 6
            WHEN p.sku = 'TR-MICROFIBER' THEN 20
            WHEN p.sku = 'KC-MICROFIBER' THEN 60
        END
    FROM product_ids p
    CROSS JOIN main_warehouse_id mw
    RETURNING id, warehouse_id, product_id, quantity_on_hand
)
SELECT * FROM inventory_inserts;

-- ============================================
-- STEP 3: Create RESTOCK Transactions for Initial Stock
-- ============================================
WITH product_ids AS (
    SELECT id, sku, retail_price FROM products 
    WHERE sku IN ('KC-SPA-TOWEL', 'TR-MICROFIBER', 'KC-MICROFIBER')
),
main_warehouse_id AS (
    SELECT '00000000-0000-0000-0000-000000000001'::uuid AS id
),
restock_transactions AS (
    INSERT INTO transactions (
        transaction_type, 
        product_id, 
        to_warehouse_id, 
        quantity, 
        unit_price,
        reference_note
    )
    SELECT 
        'RESTOCK',
        p.id,
        mw.id,
        CASE 
            WHEN p.sku = 'KC-SPA-TOWEL' THEN 6
            WHEN p.sku = 'TR-MICROFIBER' THEN 20
            WHEN p.sku = 'KC-MICROFIBER' THEN 60
        END,
        p.retail_price,
        'Initial stock - New product addition'
    FROM product_ids p
    CROSS JOIN main_warehouse_id mw
    RETURNING id, transaction_type, product_id, quantity
)
SELECT * FROM restock_transactions;

-- ============================================
-- STEP 4: Transfer to CarProofing
-- ============================================
WITH product_ids AS (
    SELECT id, sku FROM products 
    WHERE sku IN ('KC-SPA-TOWEL', 'TR-MICROFIBER', 'KC-MICROFIBER')
),
warehouse_ids AS (
    SELECT 
        '00000000-0000-0000-0000-000000000001'::uuid AS main_id,
        '00000000-0000-0000-0000-000000000002'::uuid AS carproofing_id
),
transfer_data AS (
    SELECT 
        p.id AS product_id,
        p.sku,
        w.main_id AS from_warehouse_id,
        w.carproofing_id AS to_warehouse_id,
        CASE 
            WHEN p.sku = 'KC-SPA-TOWEL' THEN 6
            WHEN p.sku = 'TR-MICROFIBER' THEN 20
            WHEN p.sku = 'KC-MICROFIBER' THEN 50
        END AS transfer_qty
    FROM product_ids p
    CROSS JOIN warehouse_ids w
),
-- Update Main Warehouse inventory (reduce quantity)
main_inventory_update AS (
    UPDATE inventory_items
    SET quantity_on_hand = quantity_on_hand - td.transfer_qty
    FROM transfer_data td
    WHERE inventory_items.warehouse_id = td.from_warehouse_id
      AND inventory_items.product_id = td.product_id
    RETURNING inventory_items.id, inventory_items.product_id, inventory_items.quantity_on_hand
),
-- Insert or update CarProofing inventory (add quantity)
carproofing_inventory_upsert AS (
    INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand)
    SELECT 
        td.to_warehouse_id,
        td.product_id,
        td.transfer_qty
    FROM transfer_data td
    ON CONFLICT (warehouse_id, product_id) 
    DO UPDATE SET quantity_on_hand = inventory_items.quantity_on_hand + EXCLUDED.quantity_on_hand
    RETURNING id, warehouse_id, product_id, quantity_on_hand
),
-- Create TRANSFER_OUT transaction
transfer_out AS (
    INSERT INTO transactions (
        transaction_type,
        product_id,
        from_warehouse_id,
        to_warehouse_id,
        quantity,
        reference_note
    )
    SELECT 
        'TRANSFER_OUT',
        td.product_id,
        td.from_warehouse_id,
        td.to_warehouse_id,
        td.transfer_qty,
        'Transfer to CarProofing - New product distribution'
    FROM transfer_data td
    RETURNING id, product_id, quantity
),
-- Create TRANSFER_IN transaction
transfer_in AS (
    INSERT INTO transactions (
        transaction_type,
        product_id,
        from_warehouse_id,
        to_warehouse_id,
        quantity,
        reference_note
    )
    SELECT 
        'TRANSFER_IN',
        td.product_id,
        td.from_warehouse_id,
        td.to_warehouse_id,
        td.transfer_qty,
        'Transfer from Main Warehouse - New product distribution'
    FROM transfer_data td
    RETURNING id, product_id, quantity
)
SELECT 
    'CarProofing transfer completed' AS status,
    COUNT(*) FILTER (WHERE transfer_out.id IS NOT NULL) AS transfer_out_count,
    COUNT(*) FILTER (WHERE transfer_in.id IS NOT NULL) AS transfer_in_count
FROM transfer_out
FULL OUTER JOIN transfer_in ON transfer_out.product_id = transfer_in.product_id;

-- ============================================
-- STEP 5: Transfer to Delta Sonic
-- ============================================
-- Note: Only Kenco Microfiber (10 pieces) transfers to Delta Sonic
-- Other products have 0 transfer quantity, so this step will only process Kenco Microfiber
WITH product_ids AS (
    SELECT id, sku FROM products 
    WHERE sku IN ('KC-SPA-TOWEL', 'TR-MICROFIBER', 'KC-MICROFIBER')
),
warehouse_ids AS (
    SELECT 
        '00000000-0000-0000-0000-000000000001'::uuid AS main_id,
        '00000000-0000-0000-0000-000000000003'::uuid AS delta_sonic_id
),
transfer_data AS (
    SELECT 
        p.id AS product_id,
        p.sku,
        w.main_id AS from_warehouse_id,
        w.delta_sonic_id AS to_warehouse_id,
        CASE 
            WHEN p.sku = 'KC-SPA-TOWEL' THEN 0
            WHEN p.sku = 'TR-MICROFIBER' THEN 0
            WHEN p.sku = 'KC-MICROFIBER' THEN 10
        END AS transfer_qty
    FROM product_ids p
    CROSS JOIN warehouse_ids w
),
-- Update Main Warehouse inventory (reduce quantity)
-- Only update if transfer_qty > 0 to avoid unnecessary updates
main_inventory_update AS (
    UPDATE inventory_items
    SET quantity_on_hand = quantity_on_hand - td.transfer_qty
    FROM transfer_data td
    WHERE inventory_items.warehouse_id = td.from_warehouse_id
      AND inventory_items.product_id = td.product_id
      AND td.transfer_qty > 0
    RETURNING inventory_items.id, inventory_items.product_id, inventory_items.quantity_on_hand
),
-- Insert or update Delta Sonic inventory (add quantity)
-- Only insert/update if transfer_qty > 0
delta_sonic_inventory_upsert AS (
    INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand)
    SELECT 
        td.to_warehouse_id,
        td.product_id,
        td.transfer_qty
    FROM transfer_data td
    WHERE td.transfer_qty > 0
    ON CONFLICT (warehouse_id, product_id) 
    DO UPDATE SET quantity_on_hand = inventory_items.quantity_on_hand + EXCLUDED.quantity_on_hand
    RETURNING id, warehouse_id, product_id, quantity_on_hand
),
-- Create TRANSFER_OUT transaction
-- Only create transactions if transfer_qty > 0
transfer_out AS (
    INSERT INTO transactions (
        transaction_type,
        product_id,
        from_warehouse_id,
        to_warehouse_id,
        quantity,
        reference_note
    )
    SELECT 
        'TRANSFER_OUT',
        td.product_id,
        td.from_warehouse_id,
        td.to_warehouse_id,
        td.transfer_qty,
        'Transfer to Delta Sonic - New product distribution'
    FROM transfer_data td
    WHERE td.transfer_qty > 0
    RETURNING id, product_id, quantity
),
-- Create TRANSFER_IN transaction
-- Only create transactions if transfer_qty > 0
transfer_in AS (
    INSERT INTO transactions (
        transaction_type,
        product_id,
        from_warehouse_id,
        to_warehouse_id,
        quantity,
        reference_note
    )
    SELECT 
        'TRANSFER_IN',
        td.product_id,
        td.from_warehouse_id,
        td.to_warehouse_id,
        td.transfer_qty,
        'Transfer from Main Warehouse - New product distribution'
    FROM transfer_data td
    WHERE td.transfer_qty > 0
    RETURNING id, product_id, quantity
)
SELECT 
    'Delta Sonic transfer completed' AS status,
    COUNT(*) FILTER (WHERE transfer_out.id IS NOT NULL) AS transfer_out_count,
    COUNT(*) FILTER (WHERE transfer_in.id IS NOT NULL) AS transfer_in_count
FROM transfer_out
FULL OUTER JOIN transfer_in ON transfer_out.product_id = transfer_in.product_id;

COMMIT;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these after the script completes to verify the data was inserted correctly:

-- 1. Check products were created with correct prices
SELECT sku, name, brand, retail_price, cost_price 
FROM products 
WHERE sku IN ('KC-SPA-TOWEL', 'TR-MICROFIBER', 'KC-MICROFIBER')
ORDER BY sku;

-- Expected results:
-- KC-MICROFIBER | Kenco Microfiber | Kenco | 100.00 | 90.00
-- KC-SPA-TOWEL  | Kenco SPA Towel  | Kenco | 100.00 | 93.00
-- TR-MICROFIBER | Turtle Microfiber| Turtle| 200.00 | 150.00

-- 2. Check inventory levels by warehouse
SELECT 
    w.name AS warehouse,
    p.sku,
    p.name AS product,
    i.quantity_on_hand
FROM inventory_items i
JOIN warehouses w ON i.warehouse_id = w.id
JOIN products p ON i.product_id = p.id
WHERE p.sku IN ('KC-SPA-TOWEL', 'TR-MICROFIBER', 'KC-MICROFIBER')
ORDER BY w.name, p.sku;

-- Expected results:
-- CarProofing   | KC-MICROFIBER | Kenco Microfiber | 50
-- CarProofing   | KC-SPA-TOWEL  | Kenco SPA Towel  | 6
-- CarProofing   | TR-MICROFIBER | Turtle Microfiber| 20
-- Delta Sonic   | KC-MICROFIBER | Kenco Microfiber | 10
-- Main Warehouse| KC-MICROFIBER | Kenco Microfiber | 0
-- Main Warehouse| KC-SPA-TOWEL  | Kenco SPA Towel  | 0
-- Main Warehouse| TR-MICROFIBER | Turtle Microfiber| 0

-- 3. Check transactions created (should see RESTOCK and TRANSFER transactions)
SELECT 
    transaction_type,
    p.sku,
    p.name AS product,
    w_from.name AS from_warehouse,
    w_to.name AS to_warehouse,
    quantity,
    t.created_at
FROM transactions t
JOIN products p ON t.product_id = p.id
LEFT JOIN warehouses w_from ON t.from_warehouse_id = w_from.id
LEFT JOIN warehouses w_to ON t.to_warehouse_id = w_to.id
WHERE p.sku IN ('KC-SPA-TOWEL', 'TR-MICROFIBER', 'KC-MICROFIBER')
ORDER BY t.created_at DESC, p.sku, transaction_type;

-- Expected transaction counts:
-- - 3 RESTOCK transactions (one per product, initial stock in Main)
-- - 3 TRANSFER_OUT transactions from Main (one per product to CarProofing, plus 1 for Kenco Microfiber to Delta Sonic)
-- - 3 TRANSFER_IN transactions (one per product to CarProofing, plus 1 for Kenco Microfiber to Delta Sonic)
-- Total: 9 transactions (3 RESTOCK + 3 TRANSFER_OUT + 3 TRANSFER_IN)

-- 4. Verify inventory math (Main Warehouse should have 0 after transfers)
SELECT
    'Main Warehouse Balance Check' AS check_type,
    p.sku,
    p.name AS product,
    i.quantity_on_hand AS remaining_in_main,
    CASE
        WHEN i.quantity_on_hand = 0 THEN '✓ Correct (all transferred)'
        ELSE '✗ Error (should be 0)'
    END AS status
FROM inventory_items i
JOIN warehouses w ON i.warehouse_id = w.id
JOIN products p ON i.product_id = p.id
WHERE w.name = 'Main Warehouse'
  AND p.sku IN ('KC-SPA-TOWEL', 'TR-MICROFIBER', 'KC-MICROFIBER')
ORDER BY p.sku;
