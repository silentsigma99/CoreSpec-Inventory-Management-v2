-- Partial Payment Support for Invoices
-- Adds PARTIALLY_PAID status, payment tracking columns, and payments table
--
-- IMPORTANT: The ALTER TYPE ... ADD VALUE statement cannot run inside a transaction.
-- In Supabase SQL editor, run this entire script in one go (it handles this correctly).

-- =============================================================================
-- STEP 1: Add PARTIALLY_PAID to invoice_status enum
-- =============================================================================
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID' AFTER 'CONFIRMED';

-- =============================================================================
-- STEP 2: Add payment tracking columns to invoices
-- =============================================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS balance_due NUMERIC(12, 2);

-- Backfill existing invoices
UPDATE public.invoices SET amount_paid = total, balance_due = 0 WHERE status = 'PAID';
UPDATE public.invoices SET balance_due = total WHERE balance_due IS NULL;

-- Now enforce NOT NULL and set default
ALTER TABLE public.invoices ALTER COLUMN balance_due SET NOT NULL;
ALTER TABLE public.invoices ALTER COLUMN balance_due SET DEFAULT 0;

-- Safety constraint: amount_paid should not exceed total (with small rounding tolerance)
ALTER TABLE public.invoices
  ADD CONSTRAINT chk_amount_paid_not_exceed_total
  CHECK (amount_paid <= total + 0.01);

-- =============================================================================
-- STEP 3: Create payments table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method TEXT,
    reference_note TEXT,
    recorded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON public.payments(created_at DESC);

-- =============================================================================
-- STEP 4: RLS policies for payments table
-- =============================================================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoice payments"
    ON public.payments FOR SELECT
    USING (
        invoice_id IN (
            SELECT id FROM public.invoices WHERE
                warehouse_id IN (SELECT id FROM public.warehouses WHERE manager_id = (SELECT auth.uid()))
                OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
        )
        OR public.is_viewer()
    );

CREATE POLICY "Users can record payments"
    ON public.payments FOR INSERT
    WITH CHECK (
        invoice_id IN (
            SELECT id FROM public.invoices WHERE
                warehouse_id IN (SELECT id FROM public.warehouses WHERE manager_id = (SELECT auth.uid()))
                OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
        )
    );

-- =============================================================================
-- STEP 5: Broaden invoice UPDATE RLS policy
-- (Remove DRAFT-only restriction; API routes enforce business rules)
-- =============================================================================
DROP POLICY IF EXISTS "Users can update draft invoices" ON public.invoices;

CREATE POLICY "Users can update invoices"
    ON public.invoices FOR UPDATE
    USING (
        (warehouse_id IN (SELECT id FROM public.warehouses WHERE manager_id = (SELECT auth.uid())))
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

-- =============================================================================
-- STEP 6: Update void_invoice to also accept PARTIALLY_PAID invoices
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

    IF v_invoice.status NOT IN ('CONFIRMED', 'PARTIALLY_PAID') THEN
        RAISE EXCEPTION 'Only CONFIRMED or PARTIALLY_PAID invoices can be voided';
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
