-- CoreSpec Inventory System - Initial Schema
-- Run this migration against your Supabase database

-- ============================================
-- ENUMS
-- ============================================

-- User roles
CREATE TYPE user_role AS ENUM ('admin', 'partner');

-- Transaction types for audit trail
CREATE TYPE transaction_type AS ENUM (
    'SALE',
    'RESTOCK', 
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'ADJUSTMENT'
);

-- ============================================
-- TABLES
-- ============================================

-- Profiles: Extends Supabase auth.users with app-specific data
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'partner',
    full_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products: Global product catalog
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    category TEXT,
    image_url TEXT,
    retail_price NUMERIC(10, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Warehouses: Physical locations (Main warehouse + partner locations)
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inventory Items: Stock levels per warehouse per product
CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_on_hand INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Each product can only appear once per warehouse
    CONSTRAINT unique_warehouse_product UNIQUE (warehouse_id, product_id),
    
    -- Stock cannot be negative
    CONSTRAINT positive_quantity CHECK (quantity_on_hand >= 0)
);

-- Transactions: Audit trail for all stock movements
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type transaction_type NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    from_warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
    to_warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL,
    reference_note TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Quantity must be positive
    CONSTRAINT positive_transaction_quantity CHECK (quantity > 0)
);

-- ============================================
-- INDEXES
-- ============================================

-- Fast lookup of inventory by warehouse
CREATE INDEX idx_inventory_warehouse ON inventory_items(warehouse_id);

-- Fast lookup of inventory by product
CREATE INDEX idx_inventory_product ON inventory_items(product_id);

-- Fast lookup of transactions by warehouse (for history views)
CREATE INDEX idx_transactions_from_warehouse ON transactions(from_warehouse_id);
CREATE INDEX idx_transactions_to_warehouse ON transactions(to_warehouse_id);

-- Fast lookup of transactions by product
CREATE INDEX idx_transactions_product ON transactions(product_id);

-- Fast lookup of transactions by date (most recent first)
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);

-- Fast lookup of warehouses by manager
CREATE INDEX idx_warehouse_manager ON warehouses(manager_id);

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_warehouses_updated_at
    BEFORE UPDATE ON warehouses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_items_updated_at
    BEFORE UPDATE ON inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- ============================================

-- Function to create profile when user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users insert
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();
