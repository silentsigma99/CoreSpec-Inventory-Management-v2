-- Fix function_search_path_mutable warnings (Supabase Lint 0011)
-- Recreate functions with SET search_path = '' and fully qualified references

-- =============================================================================
-- generate_invoice_number
-- =============================================================================
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(nextval('public.invoice_number_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- =============================================================================
-- record_sale
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_sale(
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
    FROM public.inventory_items
    WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id
    FOR UPDATE;
    
    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Product not found in warehouse inventory';
    END IF;
    
    IF v_current_qty < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock: % available, % requested', v_current_qty, p_quantity;
    END IF;
    
    UPDATE public.inventory_items 
    SET quantity_on_hand = quantity_on_hand - p_quantity
    WHERE id = v_inventory_id;
    
    INSERT INTO public.transactions (
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
$$ LANGUAGE plpgsql SET search_path = '';

-- =============================================================================
-- record_transfer
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_transfer(
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
    FROM public.inventory_items
    WHERE warehouse_id = p_from_warehouse_id AND product_id = p_product_id
    FOR UPDATE;
    
    IF v_from_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Product not found in source warehouse';
    END IF;
    
    IF v_current_qty < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock: % available, % requested', v_current_qty, p_quantity;
    END IF;
    
    UPDATE public.inventory_items 
    SET quantity_on_hand = quantity_on_hand - p_quantity
    WHERE id = v_from_inventory_id;
    
    SELECT id INTO v_to_inventory_id
    FROM public.inventory_items
    WHERE warehouse_id = p_to_warehouse_id AND product_id = p_product_id
    FOR UPDATE;
    
    IF v_to_inventory_id IS NULL THEN
        INSERT INTO public.inventory_items (warehouse_id, product_id, quantity_on_hand)
        VALUES (p_to_warehouse_id, p_product_id, p_quantity);
    ELSE
        UPDATE public.inventory_items 
        SET quantity_on_hand = quantity_on_hand + p_quantity
        WHERE id = v_to_inventory_id;
    END IF;
    
    INSERT INTO public.transactions (
        transaction_type, product_id, from_warehouse_id, to_warehouse_id,
        quantity, reference_note, created_by
    )
    VALUES (
        'TRANSFER_OUT', p_product_id, p_from_warehouse_id, p_to_warehouse_id,
        p_quantity, p_note, p_user_id
    )
    RETURNING id INTO v_transfer_out_id;
    
    INSERT INTO public.transactions (
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
$$ LANGUAGE plpgsql SET search_path = '';

-- =============================================================================
-- record_purchase
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_purchase(
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
    FROM public.inventory_items
    WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id
    FOR UPDATE;
    
    IF v_inventory_id IS NULL THEN
        INSERT INTO public.inventory_items (warehouse_id, product_id, quantity_on_hand)
        VALUES (p_warehouse_id, p_product_id, p_quantity);
    ELSE
        UPDATE public.inventory_items 
        SET quantity_on_hand = quantity_on_hand + p_quantity
        WHERE id = v_inventory_id;
    END IF;
    
    INSERT INTO public.transactions (
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
$$ LANGUAGE plpgsql SET search_path = '';

-- =============================================================================
-- record_bulk_transfer
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_bulk_transfer(
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
            SELECT inv.id, inv.quantity_on_hand INTO v_from_inventory_id, v_current_qty
            FROM public.inventory_items inv
            WHERE inv.warehouse_id = p_from_warehouse_id AND inv.product_id = v_item.product_id
            FOR UPDATE;

            IF v_from_inventory_id IS NULL THEN
                RAISE EXCEPTION 'Product % not found in source warehouse', v_item.product_id;
            END IF;

            IF v_current_qty < v_item.quantity THEN
                RAISE EXCEPTION 'Insufficient stock: % available, % requested', v_current_qty, v_item.quantity;
            END IF;

            UPDATE public.inventory_items
            SET quantity_on_hand = quantity_on_hand - v_item.quantity
            WHERE id = v_from_inventory_id;

            SELECT inv.id INTO v_to_inventory_id
            FROM public.inventory_items inv
            WHERE inv.warehouse_id = p_to_warehouse_id AND inv.product_id = v_item.product_id
            FOR UPDATE;

            IF v_to_inventory_id IS NULL THEN
                INSERT INTO public.inventory_items (warehouse_id, product_id, quantity_on_hand)
                VALUES (p_to_warehouse_id, v_item.product_id, v_item.quantity);
            ELSE
                UPDATE public.inventory_items
                SET quantity_on_hand = quantity_on_hand + v_item.quantity
                WHERE id = v_to_inventory_id;
            END IF;

            INSERT INTO public.transactions (
                transaction_type, product_id, from_warehouse_id, to_warehouse_id,
                quantity, reference_note, created_by
            )
            VALUES (
                'TRANSFER_OUT', v_item.product_id, p_from_warehouse_id, p_to_warehouse_id,
                v_item.quantity, p_note, p_user_id
            )
            RETURNING id INTO v_transfer_out_id;

            INSERT INTO public.transactions (
                transaction_type, product_id, from_warehouse_id, to_warehouse_id,
                quantity, reference_note, created_by
            )
            VALUES (
                'TRANSFER_IN', v_item.product_id, p_from_warehouse_id, p_to_warehouse_id,
                v_item.quantity, p_note, p_user_id
            )
            RETURNING id INTO v_transfer_in_id;

            product_id := v_item.product_id;
            success := TRUE;
            error_message := NULL;
            transfer_out_id := v_transfer_out_id;
            transfer_in_id := v_transfer_in_id;
            RETURN NEXT;

        EXCEPTION WHEN OTHERS THEN
            product_id := v_item.product_id;
            success := FALSE;
            error_message := SQLERRM;
            transfer_out_id := NULL;
            transfer_in_id := NULL;
            RETURN NEXT;
        END;
    END LOOP;
END;
$fn$ LANGUAGE plpgsql SET search_path = '';

-- =============================================================================
-- confirm_invoice
-- =============================================================================
CREATE OR REPLACE FUNCTION public.confirm_invoice(
    p_invoice_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_invoice RECORD;
    v_item RECORD;
    v_inventory_id UUID;
    v_current_qty INTEGER;
    v_transaction_id UUID;
BEGIN
    SELECT * INTO v_invoice FROM public.invoices 
    WHERE id = p_invoice_id AND deleted_at IS NULL
    FOR UPDATE;
    
    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;
    
    IF v_invoice.status != 'DRAFT' THEN
        RAISE EXCEPTION 'Invoice must be in DRAFT status to confirm';
    END IF;
    
    FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        SELECT id, quantity_on_hand INTO v_inventory_id, v_current_qty
        FROM public.inventory_items
        WHERE warehouse_id = v_invoice.warehouse_id AND product_id = v_item.product_id
        FOR UPDATE;
        
        IF v_inventory_id IS NULL THEN
            RAISE EXCEPTION 'Product % not found in warehouse inventory', v_item.product_id;
        END IF;
        
        IF v_current_qty < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product: % available, % requested', v_current_qty, v_item.quantity;
        END IF;
        
        UPDATE public.inventory_items 
        SET quantity_on_hand = quantity_on_hand - v_item.quantity
        WHERE id = v_inventory_id;
        
        INSERT INTO public.transactions (
            transaction_type, product_id, from_warehouse_id,
            quantity, unit_price, reference_note, created_by,
            invoice_id, invoice_item_id
        )
        VALUES (
            'SALE', v_item.product_id, v_invoice.warehouse_id,
            v_item.quantity, v_item.unit_price, 
            'Invoice ' || v_invoice.invoice_number,
            p_user_id, p_invoice_id, v_item.id
        )
        RETURNING id INTO v_transaction_id;
        
        UPDATE public.invoice_items SET transaction_id = v_transaction_id WHERE id = v_item.id;
    END LOOP;
    
    UPDATE public.invoices 
    SET status = 'CONFIRMED', confirmed_at = NOW(), updated_at = NOW()
    WHERE id = p_invoice_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- =============================================================================
-- void_invoice
-- =============================================================================
CREATE OR REPLACE FUNCTION public.void_invoice(
    p_invoice_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_invoice RECORD;
    v_item RECORD;
BEGIN
    SELECT * INTO v_invoice FROM public.invoices 
    WHERE id = p_invoice_id AND deleted_at IS NULL
    FOR UPDATE;
    
    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;
    
    IF v_invoice.status != 'CONFIRMED' THEN
        RAISE EXCEPTION 'Only CONFIRMED invoices can be voided';
    END IF;
    
    FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        UPDATE public.inventory_items 
        SET quantity_on_hand = quantity_on_hand + v_item.quantity
        WHERE warehouse_id = v_invoice.warehouse_id AND product_id = v_item.product_id;
        
        INSERT INTO public.transactions (
            transaction_type, product_id, to_warehouse_id,
            quantity, reference_note, created_by, invoice_id
        )
        VALUES (
            'ADJUSTMENT', v_item.product_id, v_invoice.warehouse_id,
            v_item.quantity, 'Voided Invoice ' || v_invoice.invoice_number,
            p_user_id, p_invoice_id
        );
    END LOOP;
    
    UPDATE public.invoices SET status = 'VOID', updated_at = NOW() WHERE id = p_invoice_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SET search_path = '';
