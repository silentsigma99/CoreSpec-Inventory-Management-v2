-- CoreSpec Inventory System - Row Level Security Policies
-- Run this AFTER 001_initial_schema.sql

-- ============================================
-- ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- HELPER FUNCTION: Check if user is admin
-- ============================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = auth.uid() 
        AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- HELPER FUNCTION: Get user's warehouse ID
-- ============================================

CREATE OR REPLACE FUNCTION get_user_warehouse_id()
RETURNS UUID AS $$
BEGIN
    RETURN (
        SELECT id FROM warehouses 
        WHERE manager_id = auth.uid()
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PROFILES POLICIES
-- ============================================

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (id = auth.uid());

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
    ON profiles FOR SELECT
    USING (is_admin());

-- Users can update their own profile (except role)
CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ============================================
-- PRODUCTS POLICIES
-- ============================================

-- Everyone can read products (global catalog)
CREATE POLICY "Anyone can view products"
    ON products FOR SELECT
    USING (true);

-- Only admins can create/update/delete products
CREATE POLICY "Admins can manage products"
    ON products FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ============================================
-- WAREHOUSES POLICIES
-- ============================================

-- Admins can see all warehouses
CREATE POLICY "Admins can view all warehouses"
    ON warehouses FOR SELECT
    USING (is_admin());

-- Partners can see their own warehouse
CREATE POLICY "Partners can view own warehouse"
    ON warehouses FOR SELECT
    USING (manager_id = auth.uid());

-- Only admins can create/update/delete warehouses
CREATE POLICY "Admins can manage warehouses"
    ON warehouses FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ============================================
-- INVENTORY ITEMS POLICIES
-- ============================================

-- Admins can see all inventory
CREATE POLICY "Admins can view all inventory"
    ON inventory_items FOR SELECT
    USING (is_admin());

-- Partners can see inventory in their warehouse
CREATE POLICY "Partners can view own warehouse inventory"
    ON inventory_items FOR SELECT
    USING (
        warehouse_id IN (
            SELECT id FROM warehouses 
            WHERE manager_id = auth.uid()
        )
    );

-- Admins can manage all inventory (for transfers)
CREATE POLICY "Admins can manage all inventory"
    ON inventory_items FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- Partners can update inventory in their warehouse (for sales)
CREATE POLICY "Partners can update own warehouse inventory"
    ON inventory_items FOR UPDATE
    USING (
        warehouse_id IN (
            SELECT id FROM warehouses 
            WHERE manager_id = auth.uid()
        )
    )
    WITH CHECK (
        warehouse_id IN (
            SELECT id FROM warehouses 
            WHERE manager_id = auth.uid()
        )
    );

-- ============================================
-- TRANSACTIONS POLICIES
-- ============================================

-- Admins can see all transactions
CREATE POLICY "Admins can view all transactions"
    ON transactions FOR SELECT
    USING (is_admin());

-- Partners can see transactions involving their warehouse
CREATE POLICY "Partners can view own warehouse transactions"
    ON transactions FOR SELECT
    USING (
        from_warehouse_id IN (SELECT id FROM warehouses WHERE manager_id = auth.uid())
        OR
        to_warehouse_id IN (SELECT id FROM warehouses WHERE manager_id = auth.uid())
    );

-- Admins can create any transaction
CREATE POLICY "Admins can create transactions"
    ON transactions FOR INSERT
    WITH CHECK (is_admin());

-- Partners can create transactions for their warehouse (sales)
CREATE POLICY "Partners can create transactions for own warehouse"
    ON transactions FOR INSERT
    WITH CHECK (
        -- For sales: from_warehouse must be their warehouse
        (
            transaction_type = 'SALE' 
            AND from_warehouse_id IN (
                SELECT id FROM warehouses WHERE manager_id = auth.uid()
            )
        )
        OR
        -- For restocks: to_warehouse must be their warehouse
        (
            transaction_type = 'RESTOCK'
            AND to_warehouse_id IN (
                SELECT id FROM warehouses WHERE manager_id = auth.uid()
            )
        )
    );

-- ============================================
-- GRANT PERMISSIONS TO AUTHENTICATED USERS
-- ============================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO authenticated;

-- Grant select on all tables to authenticated users
-- (RLS policies will filter the data)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- Grant insert/update on specific tables
GRANT INSERT, UPDATE ON inventory_items TO authenticated;
GRANT INSERT ON transactions TO authenticated;

-- Grant usage on sequences (for auto-generated IDs)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ============================================
-- SERVICE ROLE BYPASS (for backend API)
-- ============================================

-- Note: The service_role key bypasses RLS by default.
-- This is used by the FastAPI backend for admin operations
-- like transfers which touch multiple warehouses.

-- ============================================
-- TESTING QUERIES
-- ============================================

-- Test as a specific user:
-- SET LOCAL role TO authenticated;
-- SET LOCAL request.jwt.claims TO '{"sub": "USER-UUID-HERE"}';
-- SELECT * FROM inventory_items;  -- Should be filtered by RLS

-- Reset:
-- RESET role;
-- RESET request.jwt.claims;
