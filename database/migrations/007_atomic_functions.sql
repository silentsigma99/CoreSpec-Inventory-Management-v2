-- Atomic transaction functions + Main Warehouse flag
-- Ensures inventory and transaction updates happen in a single database transaction

-- =============================================================================
-- PURCHASE BATCHES TABLE (required for batch_id FK on transactions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS purchase_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number TEXT,
    vendor_bill_number TEXT,
    vendor_name TEXT,
    bill_date DATE,
    total_amount NUMERIC(12, 2),
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_batches_created ON purchase_batches(created_at DESC);

-- =============================================================================
-- ADD BATCH_ID TO TRANSACTIONS
-- =============================================================================
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES purchase_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_batch ON transactions(batch_id) WHERE batch_id IS NOT NULL;

-- =============================================================================
-- WAREHOUSE MAIN FLAG
-- =============================================================================
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_main BOOLEAN DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_main_warehouse 
ON warehouses (is_main) WHERE is_main = TRUE;

UPDATE warehouses SET is_main = TRUE WHERE name = 'Main Warehouse';

-- =============================================================================
-- ATOMIC SALE FUNCTION
-- =============================================================================
CREATE OR REPLACE FUNCTION record_sale(
    p_warehouse_id UUID,
    p_product_id UUID,
    p_quantity INTEGER,
    p_unit_price NUMERIC,
    p_note TEXT,
    p_user_id UUID
) RETURNS UUID AS $$
DECLARE
    v_inventory_id UUID;
    v_current_qty INTEGER;
    v_transaction_id UUID;
BEGIN
    SELECT id, quantity_on_hand INTO v_inventory_id, v_current_qty
    FROM inventory_items
    WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id
    FOR UPDATE;
    
    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Product not found in warehouse inventory';
    END IF;
    
    IF v_current_qty < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock: % available, % requested', v_current_qty, p_quantity;
    END IF;
    
    UPDATE inventory_items 
    SET quantity_on_hand = quantity_on_hand - p_quantity
    WHERE id = v_inventory_id;
    
    INSERT INTO transactions (
        transaction_type, product_id, from_warehouse_id, 
        quantity, unit_price, reference_note, created_by
    )
    VALUES (
        'SALE', p_product_id, p_warehouse_id, 
        p_quantity, p_unit_price, p_note, p_user_id
    )
    RETURNING id INTO v_transaction_id;
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- ATOMIC TRANSFER FUNCTION
-- =============================================================================
CREATE OR REPLACE FUNCTION record_transfer(
    p_from_warehouse_id UUID,
    p_to_warehouse_id UUID,
    p_product_id UUID,
    p_quantity INTEGER,
    p_note TEXT,
    p_user_id UUID
) RETURNS TABLE(transfer_out_id UUID, transfer_in_id UUID) AS $$
DECLARE
    v_from_inventory_id UUID;
    v_to_inventory_id UUID;
    v_current_qty INTEGER;
    v_transfer_out_id UUID;
    v_transfer_in_id UUID;
BEGIN
    SELECT id, quantity_on_hand INTO v_from_inventory_id, v_current_qty
    FROM inventory_items
    WHERE warehouse_id = p_from_warehouse_id AND product_id = p_product_id
    FOR UPDATE;
    
    IF v_from_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Product not found in source warehouse';
    END IF;
    
    IF v_current_qty < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock: % available, % requested', v_current_qty, p_quantity;
    END IF;
    
    UPDATE inventory_items 
    SET quantity_on_hand = quantity_on_hand - p_quantity
    WHERE id = v_from_inventory_id;
    
    SELECT id INTO v_to_inventory_id
    FROM inventory_items
    WHERE warehouse_id = p_to_warehouse_id AND product_id = p_product_id
    FOR UPDATE;
    
    IF v_to_inventory_id IS NULL THEN
        INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand)
        VALUES (p_to_warehouse_id, p_product_id, p_quantity);
    ELSE
        UPDATE inventory_items 
        SET quantity_on_hand = quantity_on_hand + p_quantity
        WHERE id = v_to_inventory_id;
    END IF;
    
    INSERT INTO transactions (
        transaction_type, product_id, from_warehouse_id, to_warehouse_id,
        quantity, reference_note, created_by
    )
    VALUES (
        'TRANSFER_OUT', p_product_id, p_from_warehouse_id, p_to_warehouse_id,
        p_quantity, p_note, p_user_id
    )
    RETURNING id INTO v_transfer_out_id;
    
    INSERT INTO transactions (
        transaction_type, product_id, from_warehouse_id, to_warehouse_id,
        quantity, reference_note, created_by
    )
    VALUES (
        'TRANSFER_IN', p_product_id, p_from_warehouse_id, p_to_warehouse_id,
        p_quantity, p_note, p_user_id
    )
    RETURNING id INTO v_transfer_in_id;
    
    RETURN QUERY SELECT v_transfer_out_id, v_transfer_in_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- ATOMIC PURCHASE/RESTOCK FUNCTION
-- =============================================================================
CREATE OR REPLACE FUNCTION record_purchase(
    p_warehouse_id UUID,
    p_product_id UUID,
    p_quantity INTEGER,
    p_unit_cost NUMERIC,
    p_note TEXT,
    p_user_id UUID,
    p_batch_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_inventory_id UUID;
    v_transaction_id UUID;
BEGIN
    SELECT id INTO v_inventory_id
    FROM inventory_items
    WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id
    FOR UPDATE;
    
    IF v_inventory_id IS NULL THEN
        INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand)
        VALUES (p_warehouse_id, p_product_id, p_quantity);
    ELSE
        UPDATE inventory_items 
        SET quantity_on_hand = quantity_on_hand + p_quantity
        WHERE id = v_inventory_id;
    END IF;
    
    INSERT INTO transactions (
        transaction_type, product_id, to_warehouse_id,
        quantity, unit_price, reference_note, created_by, batch_id
    )
    VALUES (
        'RESTOCK', p_product_id, p_warehouse_id,
        p_quantity, p_unit_cost, p_note, p_user_id, p_batch_id
    )
    RETURNING id INTO v_transaction_id;
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;
