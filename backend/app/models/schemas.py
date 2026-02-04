"""
Pydantic schemas for request/response validation.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum
from uuid import UUID


# ============================================
# ENUMS
# ============================================

class UserRole(str, Enum):
    ADMIN = "admin"
    PARTNER = "partner"


class TransactionType(str, Enum):
    SALE = "SALE"
    RESTOCK = "RESTOCK"
    TRANSFER_OUT = "TRANSFER_OUT"
    TRANSFER_IN = "TRANSFER_IN"
    ADJUSTMENT = "ADJUSTMENT"


# ============================================
# PROFILE SCHEMAS
# ============================================

class ProfileResponse(BaseModel):
    """User profile response."""
    id: str
    role: UserRole
    full_name: Optional[str] = None
    created_at: Optional[datetime] = None


class ProfileWithWarehouse(ProfileResponse):
    """User profile with warehouse info."""
    warehouse_id: Optional[str] = None
    warehouse_name: Optional[str] = None


# ============================================
# PRODUCT SCHEMAS
# ============================================

class ProductBase(BaseModel):
    """Base product fields."""
    sku: str
    name: str
    brand: str
    category: Optional[str] = None
    image_url: Optional[str] = None
    retail_price: Optional[float] = None  # Customer-facing retail price
    wholesale_price: Optional[float] = None  # B2B/reseller pricing tier
    cost_price: Optional[float] = None  # Product cost for margin calculations


class ProductCreate(ProductBase):
    """Create product request."""
    pass


class ProductResponse(ProductBase):
    """Product response."""
    id: str
    created_at: Optional[datetime] = None


# ============================================
# WAREHOUSE SCHEMAS
# ============================================

class WarehouseBase(BaseModel):
    """Base warehouse fields."""
    name: str


class WarehouseCreate(WarehouseBase):
    """Create warehouse request."""
    manager_id: Optional[str] = None


class WarehouseResponse(WarehouseBase):
    """Warehouse response."""
    id: str
    manager_id: Optional[str] = None
    created_at: Optional[datetime] = None


# ============================================
# INVENTORY SCHEMAS
# ============================================

class InventoryItemBase(BaseModel):
    """Base inventory item fields."""
    product_id: str
    quantity_on_hand: int = Field(ge=0, description="Stock quantity (must be >= 0)")


class InventoryItemResponse(BaseModel):
    """Inventory item with product details."""
    id: str
    warehouse_id: str
    product_id: str
    quantity_on_hand: int
    # Joined product info
    product: Optional[ProductResponse] = None
    
    class Config:
        from_attributes = True


class InventoryListResponse(BaseModel):
    """List of inventory items for a warehouse."""
    warehouse_id: str
    warehouse_name: str
    items: List[InventoryItemResponse]
    total_items: int
    page: int
    page_size: int
    low_stock_count: int  # Items with qty < 5


# ============================================
# TRANSFER SCHEMAS
# ============================================

class TransferRequest(BaseModel):
    """Request to transfer stock between warehouses."""
    from_warehouse_id: str = Field(..., description="Source warehouse UUID")
    to_warehouse_id: str = Field(..., description="Destination warehouse UUID")
    product_id: str = Field(..., description="Product UUID to transfer")
    quantity: int = Field(..., gt=0, description="Quantity to transfer (must be > 0)")
    reference_note: Optional[str] = Field(None, max_length=500, description="Optional note")


class TransferResponse(BaseModel):
    """Response after successful transfer."""
    success: bool
    message: str
    transfer_out_id: str
    transfer_in_id: str
    from_warehouse_id: str
    to_warehouse_id: str
    product_id: str
    quantity: int


# ============================================
# SALE SCHEMAS
# ============================================

class SaleRequest(BaseModel):
    """Request to record a sale."""
    warehouse_id: str = Field(..., description="Warehouse where sale occurred")
    product_id: str = Field(..., description="Product UUID sold")
    quantity: int = Field(..., gt=0, description="Quantity sold (must be > 0)")
    unit_price: Optional[float] = Field(
        None, 
        ge=0, 
        description="Sale price per unit (defaults to product retail_price if not provided)"
    )
    reference_note: Optional[str] = Field(None, max_length=500, description="Customer name or note")


class SaleResponse(BaseModel):
    """Response after successful sale."""
    success: bool
    message: str
    transaction_id: str
    warehouse_id: str
    product_id: str
    quantity: int
    unit_price: Optional[float] = None  # Actual sale price per unit
    new_stock_level: int


# ============================================
# PURCHASE SCHEMAS
# ============================================

class PurchaseRequest(BaseModel):
    """Request to record a purchase (restock)."""
    warehouse_id: str = Field(..., description="Warehouse receiving the stock")
    product_id: str = Field(..., description="Product UUID purchased")
    quantity: int = Field(..., gt=0, description="Quantity purchased (must be > 0)")
    unit_cost: Optional[float] = Field(
        None,
        ge=0,
        description="Cost per unit (defaults to product cost_price if not provided)"
    )
    reference_note: Optional[str] = Field(None, max_length=500, description="Supplier name or invoice reference")


class PurchaseResponse(BaseModel):
    """Response after successful purchase."""
    success: bool
    message: str
    transaction_id: str
    warehouse_id: str
    product_id: str
    quantity: int
    unit_cost: Optional[float] = None  # Actual cost per unit
    new_stock_level: int


# ============================================
# TRANSACTION SCHEMAS
# ============================================

class TransactionResponse(BaseModel):
    """Transaction record response."""
    id: str
    transaction_type: TransactionType
    product_id: str
    from_warehouse_id: Optional[str] = None
    to_warehouse_id: Optional[str] = None
    quantity: int
    unit_price: Optional[float] = None  # Sale price (for SALE transactions)
    reference_note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    # Joined info
    product: Optional[ProductResponse] = None
    from_warehouse: Optional[WarehouseResponse] = None
    to_warehouse: Optional[WarehouseResponse] = None


class TransactionListResponse(BaseModel):
    """Paginated list of transactions."""
    items: List[TransactionResponse]
    total: int
    page: int
    page_size: int


# ============================================
# GENERIC RESPONSES
# ============================================

class BrandsResponse(BaseModel):
    """List of unique brand names."""
    brands: List[str]


class MessageResponse(BaseModel):
    """Simple message response."""
    message: str


class ErrorResponse(BaseModel):
    """Error response."""
    detail: str
