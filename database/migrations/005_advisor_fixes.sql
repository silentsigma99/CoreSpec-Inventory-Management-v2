-- CoreSpec Inventory System - Supabase Advisor Fixes
-- Addresses security and performance warnings from Supabase linter
--
-- Issues fixed:
--   1. Function search_path mutable (4 functions)
--   2. Missing FK index on transactions.created_by
--   3. RLS InitPlan - auth.uid() re-evaluation per row (8 policies)
--   4. Multiple permissive policies per role/action

-- ============================================
-- UP MIGRATION
-- ============================================

-- ============================================
-- STEP 1: FIX FUNCTION SEARCH PATH (Security)
-- ============================================
-- Recreate functions with SET search_path = '' to prevent
-- search path injection attacks

-- 1a. Fix update_updated_at_column()
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 1b. Fix handle_new_user()
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, role, full_name)
    VALUES (
        NEW.id,
        'partner',
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 1c. Fix is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = (SELECT auth.uid())
        AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 1d. Fix get_user_warehouse_id()
CREATE OR REPLACE FUNCTION public.get_user_warehouse_id()
RETURNS UUID AS $$
BEGIN
    RETURN (
        SELECT id FROM public.warehouses 
        WHERE manager_id = (SELECT auth.uid())
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ============================================
-- STEP 2: ADD MISSING FOREIGN KEY INDEX (Performance)
-- ============================================
-- Index on transactions.created_by for FK join performance

CREATE INDEX IF NOT EXISTS idx_transactions_created_by 
ON public.transactions(created_by);

-- ============================================
-- STEP 3 & 4: FIX RLS POLICIES (Performance)
-- ============================================
-- - Use (select auth.uid()) to evaluate once per query, not per row
-- - Consolidate multiple permissive policies into single policies

-- --------------------------------------------
-- PROFILES TABLE
-- --------------------------------------------

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Consolidated SELECT policy (admins see all, users see own)
CREATE POLICY "Select own or admin sees all profiles"
    ON public.profiles FOR SELECT
    USING (
        id = (SELECT auth.uid())
        OR 
        public.is_admin()
    );

-- UPDATE policy with InitPlan fix
CREATE POLICY "Update own profile"
    ON public.profiles FOR UPDATE
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));

-- --------------------------------------------
-- PRODUCTS TABLE
-- --------------------------------------------

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view products" ON public.products;
DROP POLICY IF EXISTS "Admins can manage products" ON public.products;

-- SELECT policy - anyone can view (no change needed, just recreate)
CREATE POLICY "Anyone can view products"
    ON public.products FOR SELECT
    USING (true);

-- Separate INSERT/UPDATE/DELETE policy for admins only
CREATE POLICY "Admins can write products"
    ON public.products FOR INSERT
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update products"
    ON public.products FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete products"
    ON public.products FOR DELETE
    USING (public.is_admin());

-- --------------------------------------------
-- WAREHOUSES TABLE
-- --------------------------------------------

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view all warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Partners can view own warehouse" ON public.warehouses;
DROP POLICY IF EXISTS "Admins can manage warehouses" ON public.warehouses;

-- Consolidated SELECT policy with InitPlan fix
CREATE POLICY "Select own or admin sees all warehouses"
    ON public.warehouses FOR SELECT
    USING (
        manager_id = (SELECT auth.uid())
        OR 
        public.is_admin()
    );

-- Separate write policies for admins
CREATE POLICY "Admins can insert warehouses"
    ON public.warehouses FOR INSERT
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update warehouses"
    ON public.warehouses FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete warehouses"
    ON public.warehouses FOR DELETE
    USING (public.is_admin());

-- --------------------------------------------
-- INVENTORY_ITEMS TABLE
-- --------------------------------------------

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view all inventory" ON public.inventory_items;
DROP POLICY IF EXISTS "Partners can view own warehouse inventory" ON public.inventory_items;
DROP POLICY IF EXISTS "Admins can manage all inventory" ON public.inventory_items;
DROP POLICY IF EXISTS "Partners can update own warehouse inventory" ON public.inventory_items;

-- Consolidated SELECT policy with InitPlan fix
CREATE POLICY "Select inventory for own warehouse or admin"
    ON public.inventory_items FOR SELECT
    USING (
        warehouse_id IN (
            SELECT id FROM public.warehouses 
            WHERE manager_id = (SELECT auth.uid())
        )
        OR 
        public.is_admin()
    );

-- Consolidated UPDATE policy with InitPlan fix
CREATE POLICY "Update inventory for own warehouse or admin"
    ON public.inventory_items FOR UPDATE
    USING (
        warehouse_id IN (
            SELECT id FROM public.warehouses 
            WHERE manager_id = (SELECT auth.uid())
        )
        OR 
        public.is_admin()
    )
    WITH CHECK (
        warehouse_id IN (
            SELECT id FROM public.warehouses 
            WHERE manager_id = (SELECT auth.uid())
        )
        OR 
        public.is_admin()
    );

-- INSERT policy for admins (transfers create new inventory items)
CREATE POLICY "Admins can insert inventory"
    ON public.inventory_items FOR INSERT
    WITH CHECK (public.is_admin());

-- DELETE policy for admins
CREATE POLICY "Admins can delete inventory"
    ON public.inventory_items FOR DELETE
    USING (public.is_admin());

-- --------------------------------------------
-- TRANSACTIONS TABLE
-- --------------------------------------------

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.transactions;
DROP POLICY IF EXISTS "Partners can view own warehouse transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins can create transactions" ON public.transactions;
DROP POLICY IF EXISTS "Partners can create transactions for own warehouse" ON public.transactions;

-- Consolidated SELECT policy with InitPlan fix
CREATE POLICY "Select transactions for own warehouse or admin"
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
    );

-- Consolidated INSERT policy with InitPlan fix
CREATE POLICY "Insert transactions for own warehouse or admin"
    ON public.transactions FOR INSERT
    WITH CHECK (
        -- Admins can create any transaction
        public.is_admin()
        OR
        -- Partners: SALE from their warehouse
        (
            transaction_type = 'SALE' 
            AND from_warehouse_id IN (
                SELECT id FROM public.warehouses 
                WHERE manager_id = (SELECT auth.uid())
            )
        )
        OR
        -- Partners: RESTOCK to their warehouse
        (
            transaction_type = 'RESTOCK'
            AND to_warehouse_id IN (
                SELECT id FROM public.warehouses 
                WHERE manager_id = (SELECT auth.uid())
            )
        )
    );

-- ============================================
-- DOWN MIGRATION (Rollback)
-- ============================================
-- To rollback, run these commands:
--
-- -- Restore original functions (without search_path)
-- CREATE OR REPLACE FUNCTION public.update_updated_at_column()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     NEW.updated_at = NOW();
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
--
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     INSERT INTO public.profiles (id, role, full_name)
--     VALUES (
--         NEW.id,
--         'partner',
--         COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
--     );
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;
--
-- CREATE OR REPLACE FUNCTION public.is_admin()
-- RETURNS BOOLEAN AS $$
-- BEGIN
--     RETURN EXISTS (
--         SELECT 1 FROM profiles 
--         WHERE id = auth.uid() 
--         AND role = 'admin'
--     );
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;
--
-- CREATE OR REPLACE FUNCTION public.get_user_warehouse_id()
-- RETURNS UUID AS $$
-- BEGIN
--     RETURN (
--         SELECT id FROM warehouses 
--         WHERE manager_id = auth.uid()
--         LIMIT 1
--     );
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;
--
-- -- Drop new index
-- DROP INDEX IF EXISTS idx_transactions_created_by;
--
-- -- Re-run 002_row_level_security.sql to restore original policies
