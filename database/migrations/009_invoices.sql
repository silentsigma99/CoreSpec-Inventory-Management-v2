-- Invoices and invoice items for invoiced sales
-- State machine: DRAFT -> CONFIRMED (reserves stock) -> PAID

CREATE TYPE invoice_status AS ENUM ('DRAFT', 'CONFIRMED', 'PAID', 'CANCELLED', 'VOID');

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(nextval('invoice_number_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT UNIQUE NOT NULL DEFAULT generate_invoice_number(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    customer_address TEXT,
    customer_email TEXT,
    status invoice_status NOT NULL DEFAULT 'DRAFT',
    confirmed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    due_date DATE,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount NUMERIC(12, 2) DEFAULT 0,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL,
    line_total NUMERIC(12, 2) NOT NULL,
    transaction_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS invoice_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS invoice_item_id UUID;

ALTER TABLE invoice_items
    ADD CONSTRAINT fk_invoice_items_transaction
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;

ALTER TABLE transactions
    ADD CONSTRAINT fk_transactions_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE transactions
    ADD CONSTRAINT fk_transactions_invoice_item
    FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id) ON DELETE SET NULL;

CREATE INDEX idx_invoices_warehouse ON invoices(warehouse_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_created ON invoices(created_at DESC);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_product ON invoice_items(product_id);

CREATE OR REPLACE FUNCTION confirm_invoice(
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
    SELECT * INTO v_invoice FROM invoices 
    WHERE id = p_invoice_id AND deleted_at IS NULL
    FOR UPDATE;
    
    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;
    
    IF v_invoice.status != 'DRAFT' THEN
        RAISE EXCEPTION 'Invoice must be in DRAFT status to confirm';
    END IF;
    
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        SELECT id, quantity_on_hand INTO v_inventory_id, v_current_qty
        FROM inventory_items
        WHERE warehouse_id = v_invoice.warehouse_id AND product_id = v_item.product_id
        FOR UPDATE;
        
        IF v_inventory_id IS NULL THEN
            RAISE EXCEPTION 'Product % not found in warehouse inventory', v_item.product_id;
        END IF;
        
        IF v_current_qty < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product: % available, % requested', v_current_qty, v_item.quantity;
        END IF;
        
        UPDATE inventory_items 
        SET quantity_on_hand = quantity_on_hand - v_item.quantity
        WHERE id = v_inventory_id;
        
        INSERT INTO transactions (
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
        
        UPDATE invoice_items SET transaction_id = v_transaction_id WHERE id = v_item.id;
    END LOOP;
    
    UPDATE invoices 
    SET status = 'CONFIRMED', confirmed_at = NOW(), updated_at = NOW()
    WHERE id = p_invoice_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION void_invoice(
    p_invoice_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_invoice RECORD;
    v_item RECORD;
BEGIN
    SELECT * INTO v_invoice FROM invoices 
    WHERE id = p_invoice_id AND deleted_at IS NULL
    FOR UPDATE;
    
    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;
    
    IF v_invoice.status != 'CONFIRMED' THEN
        RAISE EXCEPTION 'Only CONFIRMED invoices can be voided';
    END IF;
    
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        UPDATE inventory_items 
        SET quantity_on_hand = quantity_on_hand + v_item.quantity
        WHERE warehouse_id = v_invoice.warehouse_id AND product_id = v_item.product_id;
        
        INSERT INTO transactions (
            transaction_type, product_id, to_warehouse_id,
            quantity, reference_note, created_by, invoice_id
        )
        VALUES (
            'ADJUSTMENT', v_item.product_id, v_invoice.warehouse_id,
            v_item.quantity, 'Voided Invoice ' || v_invoice.invoice_number,
            p_user_id, p_invoice_id
        );
    END LOOP;
    
    UPDATE invoices SET status = 'VOID', updated_at = NOW() WHERE id = p_invoice_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view warehouse invoices"
    ON invoices FOR SELECT
    USING (
        warehouse_id IN (SELECT id FROM warehouses WHERE manager_id = auth.uid())
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Users can create invoices"
    ON invoices FOR INSERT
    WITH CHECK (
        warehouse_id IN (SELECT id FROM warehouses WHERE manager_id = auth.uid())
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Users can update draft invoices"
    ON invoices FOR UPDATE
    USING (
        (status = 'DRAFT' AND warehouse_id IN (SELECT id FROM warehouses WHERE manager_id = auth.uid()))
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Users can view invoice items"
    ON invoice_items FOR SELECT
    USING (
        invoice_id IN (
            SELECT id FROM invoices WHERE 
                warehouse_id IN (SELECT id FROM warehouses WHERE manager_id = auth.uid())
                OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        )
    );

CREATE POLICY "Users can manage invoice items"
    ON invoice_items FOR ALL
    USING (
        invoice_id IN (
            SELECT id FROM invoices WHERE status = 'DRAFT' AND (
                warehouse_id IN (SELECT id FROM warehouses WHERE manager_id = auth.uid())
                OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
            )
        )
    );

CREATE POLICY "Admins can manage customers"
    ON customers FOR ALL
    USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );
