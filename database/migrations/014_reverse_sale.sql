-- Migration 014: Add soft-delete to transactions and reverse_sale function
-- Run this in Supabase SQL editor

-- 1. Add deleted_at column to transactions table
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index for efficient filtering of deleted records
CREATE INDEX IF NOT EXISTS idx_transactions_deleted_at
ON public.transactions(deleted_at)
WHERE deleted_at IS NOT NULL;

-- 2. Create reverse_sale RPC function (follows void_invoice pattern)
CREATE OR REPLACE FUNCTION public.reverse_sale(
    p_transaction_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_txn RECORD;
    v_inventory_id UUID;
BEGIN
    -- Lock the transaction row
    SELECT * INTO v_txn FROM public.transactions
    WHERE id = p_transaction_id AND deleted_at IS NULL
    FOR UPDATE;

    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'Transaction not found or already deleted';
    END IF;

    IF v_txn.transaction_type != 'SALE' THEN
        RAISE EXCEPTION 'Only SALE transactions can be reversed';
    END IF;

    IF v_txn.invoice_id IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot reverse an invoiced sale. Void the invoice instead.';
    END IF;

    -- Restore inventory quantity
    SELECT id INTO v_inventory_id
    FROM public.inventory_items
    WHERE warehouse_id = v_txn.from_warehouse_id AND product_id = v_txn.product_id
    FOR UPDATE;

    IF v_inventory_id IS NULL THEN
        INSERT INTO public.inventory_items (warehouse_id, product_id, quantity_on_hand)
        VALUES (v_txn.from_warehouse_id, v_txn.product_id, v_txn.quantity);
    ELSE
        UPDATE public.inventory_items
        SET quantity_on_hand = quantity_on_hand + v_txn.quantity
        WHERE id = v_inventory_id;
    END IF;

    -- Create ADJUSTMENT audit trail record
    INSERT INTO public.transactions (
        transaction_type, product_id, to_warehouse_id,
        quantity, unit_price, reference_note, created_by
    )
    VALUES (
        'ADJUSTMENT', v_txn.product_id, v_txn.from_warehouse_id,
        v_txn.quantity, v_txn.unit_price,
        'Reversed sale ' || v_txn.id::TEXT,
        p_user_id
    );

    -- Soft-delete the original transaction
    UPDATE public.transactions
    SET deleted_at = NOW()
    WHERE id = p_transaction_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SET search_path = '';
