-- ============================================
-- ADD KENCO MICROFIBER TO INVOICE INV-2026-00002
-- ============================================
-- Context: When invoice INV-2026-00002 (CarProofing) was created, Kenco Microfiber
-- hadn't been added to the system yet. The product now exists.
-- This adds the missing line item: 40 pieces @ Rs.100 (total Rs.4,000).
--
-- The invoice is in PARTIAL status (already confirmed, partially paid).
-- Stock for other items was already deducted on confirmation.
-- We need to: add the line item, update totals, deduct inventory, create SALE transaction.
--
-- PREREQUISITES: Kenco Microfiber product (SKU: KC-MICROFIBER) must already exist
-- with 50 qty at CarProofing (run add_products_and_transfers.sql first).
--
-- INSTRUCTIONS: Run this script in Supabase SQL Editor.
-- ============================================

BEGIN;

-- Step 1: Add invoice line item + create SALE transaction + deduct inventory
WITH invoice_data AS (
    SELECT id AS invoice_id, invoice_number, warehouse_id
    FROM invoices
    WHERE invoice_number = 'INV-2026-00002'
      AND deleted_at IS NULL
),
product_data AS (
    SELECT id AS product_id
    FROM products
    WHERE sku = 'KC-MICROFIBER'
),
-- Insert the invoice line item
new_item AS (
    INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, line_total)
    SELECT
        inv.invoice_id,
        p.product_id,
        40,
        100.00,
        4000.00
    FROM invoice_data inv
    CROSS JOIN product_data p
    RETURNING id AS item_id, invoice_id, product_id, quantity, unit_price
),
-- Create the SALE transaction
new_transaction AS (
    INSERT INTO transactions (
        transaction_type,
        product_id,
        from_warehouse_id,
        quantity,
        unit_price,
        reference_note,
        invoice_id,
        invoice_item_id
    )
    SELECT
        'SALE',
        ni.product_id,
        inv.warehouse_id,
        ni.quantity,
        ni.unit_price,
        'Invoice ' || inv.invoice_number,
        ni.invoice_id,
        ni.item_id
    FROM new_item ni
    JOIN invoice_data inv ON ni.invoice_id = inv.invoice_id
    RETURNING id AS transaction_id, product_id, quantity
),
-- Link transaction back to invoice item
link_transaction AS (
    UPDATE invoice_items
    SET transaction_id = nt.transaction_id
    FROM new_transaction nt, new_item ni
    WHERE invoice_items.id = ni.item_id
    RETURNING invoice_items.id
),
-- Deduct inventory: CarProofing (00000000-0000-0000-0000-000000000002) - Kenco Microfiber
inventory_update AS (
    UPDATE inventory_items
    SET quantity_on_hand = quantity_on_hand - 40
    WHERE warehouse_id = '00000000-0000-0000-0000-000000000002'
      AND product_id = (SELECT product_id FROM product_data)
    RETURNING id, quantity_on_hand
)
SELECT
    'Line item added' AS step,
    ni.item_id,
    nt.transaction_id,
    iu.quantity_on_hand AS new_inventory_qty
FROM new_item ni
CROSS JOIN new_transaction nt
CROSS JOIN inventory_update iu;

-- Step 2: Update invoice totals
UPDATE invoices
SET
    subtotal = subtotal + 4000,
    total = total + 4000,
    balance_due = balance_due + 4000,
    updated_at = NOW()
WHERE invoice_number = 'INV-2026-00002'
  AND deleted_at IS NULL;

COMMIT;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- 1. Show updated invoice totals
SELECT
    invoice_number,
    customer_name,
    status,
    subtotal,
    discount,
    total,
    amount_paid,
    balance_due
FROM invoices
WHERE invoice_number = 'INV-2026-00002';

-- 2. Show all line items for the invoice (confirm Kenco Microfiber is present)
SELECT
    p.sku,
    p.name AS product,
    ii.quantity,
    ii.unit_price,
    ii.line_total,
    ii.transaction_id
FROM invoice_items ii
JOIN products p ON ii.product_id = p.id
WHERE ii.invoice_id = (SELECT id FROM invoices WHERE invoice_number = 'INV-2026-00002')
ORDER BY ii.created_at;

-- 3. Show updated Kenco Microfiber inventory at CarProofing (should be 10)
SELECT
    w.name AS warehouse,
    p.sku,
    p.name AS product,
    i.quantity_on_hand,
    CASE
        WHEN i.quantity_on_hand = 10 THEN '✓ Correct (50 - 40 = 10)'
        ELSE '✗ Unexpected (expected 10)'
    END AS status
FROM inventory_items i
JOIN warehouses w ON i.warehouse_id = w.id
JOIN products p ON i.product_id = p.id
WHERE w.id = '00000000-0000-0000-0000-000000000002'
  AND p.sku = 'KC-MICROFIBER';

-- 4. Show the new SALE transaction record
SELECT
    t.id,
    t.transaction_type,
    p.sku,
    p.name AS product,
    w.name AS from_warehouse,
    t.quantity,
    t.unit_price,
    t.reference_note,
    t.invoice_id,
    t.created_at
FROM transactions t
JOIN products p ON t.product_id = p.id
LEFT JOIN warehouses w ON t.from_warehouse_id = w.id
WHERE p.sku = 'KC-MICROFIBER'
  AND t.transaction_type = 'SALE'
ORDER BY t.created_at DESC
LIMIT 1;
