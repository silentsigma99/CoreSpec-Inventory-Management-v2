-- CoreSpec Inventory System - Viewer Role
-- Adds a read-only 'viewer' role that can see all warehouses, inventory,
-- and transactions but cannot create, update, or delete anything.

-- ============================================
-- STEP 1: ADD VIEWER TO USER_ROLE ENUM
-- ============================================

ALTER TYPE user_role ADD VALUE 'viewer';

-- ============================================
-- STEP 2: ADD is_viewer() HELPER FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION public.is_viewer()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = (SELECT auth.uid())
        AND role = 'viewer'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ============================================
-- STEP 3: UPDATE RLS SELECT POLICIES
-- ============================================
-- Add viewer access to all SELECT policies.
-- Viewers get NO insert/update/delete access.

-- --------------------------------------------
-- PROFILES TABLE
-- --------------------------------------------

DROP POLICY IF EXISTS "Select own or admin sees all profiles" ON public.profiles;

CREATE POLICY "Select own or admin or viewer sees all profiles"
    ON public.profiles FOR SELECT
    USING (
        id = (SELECT auth.uid())
        OR
        public.is_admin()
        OR
        public.is_viewer()
    );

-- PRODUCTS TABLE: No change needed (already allows anyone to view)

-- --------------------------------------------
-- WAREHOUSES TABLE
-- --------------------------------------------

DROP POLICY IF EXISTS "Select own or admin sees all warehouses" ON public.warehouses;

CREATE POLICY "Select own or admin or viewer sees all warehouses"
    ON public.warehouses FOR SELECT
    USING (
        manager_id = (SELECT auth.uid())
        OR
        public.is_admin()
        OR
        public.is_viewer()
    );

-- --------------------------------------------
-- INVENTORY_ITEMS TABLE
-- --------------------------------------------

DROP POLICY IF EXISTS "Select inventory for own warehouse or admin" ON public.inventory_items;

CREATE POLICY "Select inventory for own warehouse or admin or viewer"
    ON public.inventory_items FOR SELECT
    USING (
        warehouse_id IN (
            SELECT id FROM public.warehouses
            WHERE manager_id = (SELECT auth.uid())
        )
        OR
        public.is_admin()
        OR
        public.is_viewer()
    );

-- --------------------------------------------
-- TRANSACTIONS TABLE
-- --------------------------------------------

DROP POLICY IF EXISTS "Select transactions for own warehouse or admin" ON public.transactions;

CREATE POLICY "Select transactions for own warehouse or admin or viewer"
    ON public.transactions FOR SELECT
    USING (
        from_warehouse_id IN (
            SELECT id FROM public.warehouses
            WHERE manager_id = (SELECT auth.uid())
        )
        OR
        to_warehouse_id IN (
            SELECT id FROM public.warehouses
            WHERE manager_id = (SELECT auth.uid())
        )
        OR
        public.is_admin()
        OR
        public.is_viewer()
    );

-- --------------------------------------------
-- INVOICES TABLE
-- --------------------------------------------

DROP POLICY IF EXISTS "Users can view warehouse invoices" ON public.invoices;

CREATE POLICY "Users can view warehouse invoices"
    ON public.invoices FOR SELECT
    USING (
        warehouse_id IN (SELECT id FROM public.warehouses WHERE manager_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
        OR public.is_viewer()
    );

-- --------------------------------------------
-- INVOICE_ITEMS TABLE
-- --------------------------------------------

DROP POLICY IF EXISTS "Users can view invoice items" ON public.invoice_items;

CREATE POLICY "Users can view invoice items"
    ON public.invoice_items FOR SELECT
    USING (
        invoice_id IN (
            SELECT id FROM public.invoices WHERE
                warehouse_id IN (SELECT id FROM public.warehouses WHERE manager_id = (SELECT auth.uid()))
                OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
        )
        OR public.is_viewer()
    );

-- --------------------------------------------
-- CUSTOMERS TABLE
-- --------------------------------------------

DROP POLICY IF EXISTS "Admins can manage customers" ON public.customers;

-- Admins get full access, viewers get read-only
CREATE POLICY "Admins can manage customers"
    ON public.customers FOR ALL
    USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

CREATE POLICY "Viewers can view customers"
    ON public.customers FOR SELECT
    USING (
        public.is_viewer()
    );
