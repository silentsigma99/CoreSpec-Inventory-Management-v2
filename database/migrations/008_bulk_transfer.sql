-- =============================================================================
-- BULK TRANSFER FUNCTION
-- Processes multiple transfers in a single round-trip with partial success support.
-- Features: deduplication, sorted locking (deadlock prevention), batch limit,
-- per-item savepoints (one failure does not roll back others).
-- =============================================================================

CREATE OR REPLACE FUNCTION record_bulk_transfer(
    p_from_warehouse_id UUID,
    p_to_warehouse_id UUID,
    p_items JSONB,
    p_note TEXT,
    p_user_id UUID
) RETURNS TABLE(
    product_id UUID,
    success BOOLEAN,
    error_message TEXT,
    transfer_out_id UUID,
    transfer_in_id UUID
) AS $fn$
DECLARE
    v_item RECORD;
    v_from_inventory_id UUID;
    v_to_inventory_id UUID;
    v_current_qty INTEGER;
    v_transfer_out_id UUID;
    v_transfer_in_id UUID;
    v_item_count INTEGER;
BEGIN
    -- Batch limit: max 100 items (after deduplication)
    SELECT COUNT(*)::INTEGER INTO v_item_count
    FROM (
        SELECT (elem->>'product_id')::UUID AS pid
        FROM jsonb_array_elements(p_items) AS elem
        WHERE elem->>'product_id' IS NOT NULL
          AND (elem->>'quantity')::INT > 0
        GROUP BY (elem->>'product_id')::UUID
    ) deduped;

    IF v_item_count > 100 THEN
        RAISE EXCEPTION 'Batch size exceeds limit of 100 items. Got % items.', v_item_count;
    END IF;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'No valid items to transfer';
    END IF;

    -- Process items: deduplicated (sum quantities), sorted by product_id for deadlock prevention
    FOR v_item IN
        SELECT
            (pid)::UUID AS product_id,
            SUM(qty)::INTEGER AS quantity
        FROM (
            SELECT
                (elem->>'product_id')::UUID AS pid,
                COALESCE((elem->>'quantity')::INT, 0) AS qty
            FROM jsonb_array_elements(p_items) AS elem
            WHERE elem->>'product_id' IS NOT NULL
              AND (elem->>'quantity')::INT > 0
        ) raw
        GROUP BY pid
        ORDER BY pid
    LOOP
        BEGIN
            -- Lock source inventory row (consistent order prevents deadlocks)
            SELECT inv.id, inv.quantity_on_hand INTO v_from_inventory_id, v_current_qty
            FROM inventory_items inv
            WHERE inv.warehouse_id = p_from_warehouse_id AND inv.product_id = v_item.product_id
            FOR UPDATE;

            IF v_from_inventory_id IS NULL THEN
                RAISE EXCEPTION 'Product % not found in source warehouse', v_item.product_id;
            END IF;

            IF v_current_qty < v_item.quantity THEN
                RAISE EXCEPTION 'Insufficient stock: % available, % requested', v_current_qty, v_item.quantity;
            END IF;

            -- Decrement source
            UPDATE inventory_items
            SET quantity_on_hand = quantity_on_hand - v_item.quantity
            WHERE id = v_from_inventory_id;

            -- Get or create destination inventory
            SELECT inv.id INTO v_to_inventory_id
            FROM inventory_items inv
            WHERE inv.warehouse_id = p_to_warehouse_id AND inv.product_id = v_item.product_id
            FOR UPDATE;

            IF v_to_inventory_id IS NULL THEN
                INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand)
                VALUES (p_to_warehouse_id, v_item.product_id, v_item.quantity);
            ELSE
                UPDATE inventory_items
                SET quantity_on_hand = quantity_on_hand + v_item.quantity
                WHERE id = v_to_inventory_id;
            END IF;

            -- Create TRANSFER_OUT
            INSERT INTO transactions (
                transaction_type, product_id, from_warehouse_id, to_warehouse_id,
                quantity, reference_note, created_by
            )
            VALUES (
                'TRANSFER_OUT', v_item.product_id, p_from_warehouse_id, p_to_warehouse_id,
                v_item.quantity, p_note, p_user_id
            )
            RETURNING id INTO v_transfer_out_id;

            -- Create TRANSFER_IN
            INSERT INTO transactions (
                transaction_type, product_id, from_warehouse_id, to_warehouse_id,
                quantity, reference_note, created_by
            )
            VALUES (
                'TRANSFER_IN', v_item.product_id, p_from_warehouse_id, p_to_warehouse_id,
                v_item.quantity, p_note, p_user_id
            )
            RETURNING id INTO v_transfer_in_id;

            -- Return success row
            product_id := v_item.product_id;
            success := TRUE;
            error_message := NULL;
            transfer_out_id := v_transfer_out_id;
            transfer_in_id := v_transfer_in_id;
            RETURN NEXT;

        EXCEPTION WHEN OTHERS THEN
            -- Per-item savepoint: record failure, continue to next item
            product_id := v_item.product_id;
            success := FALSE;
            error_message := SQLERRM;
            transfer_out_id := NULL;
            transfer_in_id := NULL;
            RETURN NEXT;
        END;
    END LOOP;
END;
$fn$ LANGUAGE plpgsql;
