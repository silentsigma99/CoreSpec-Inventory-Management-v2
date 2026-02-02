"""
Inventory API routes.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from typing import List

from app.core.auth import get_current_user, get_supabase_client, UserContext
from app.models.schemas import (
    InventoryItemResponse,
    InventoryListResponse,
    ProductResponse,
)


router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("/{warehouse_id}", response_model=InventoryListResponse)
async def get_warehouse_inventory(
    warehouse_id: str,
    page: int = 1,
    page_size: int = 50,
    search: str = None,
    user: UserContext = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> InventoryListResponse:
    """
    Get inventory for a specific warehouse with pagination and search.
    
    - Partners can only view their own warehouse
    - Admins can view any warehouse
    
    Returns:
        InventoryListResponse: Paginated list of inventory items.
    """
    # Check access permissions
    if user.role != "admin" and user.warehouse_id != warehouse_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this warehouse",
        )
    
    # Get warehouse info
    warehouse_response = supabase.table("warehouses").select("*").eq("id", warehouse_id).single().execute()
    
    if not warehouse_response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found",
        )
    
    warehouse = warehouse_response.data
    
    # If search is provided, first find matching product IDs
    product_ids = None
    if search:
        # Search products by SKU or name
        search_term = f"%{search}%"
        products_response = supabase.table("products")\
            .select("id")\
            .or_(f"sku.ilike.{search_term},name.ilike.{search_term},brand.ilike.{search_term}")\
            .execute()
        product_ids = [p["id"] for p in (products_response.data or [])]

        # If no products match, return empty result early
        if not product_ids:
            return InventoryListResponse(
                warehouse_id=warehouse_id,
                warehouse_name=warehouse["name"],
                items=[],
                total_items=0,
                page=page,
                page_size=page_size,
                low_stock_count=0,
            )

    # Base query
    query = supabase.table("inventory_items")\
        .select("*, products(*)", count="exact")\
        .eq("warehouse_id", warehouse_id)

    # Apply product filter if searching
    if product_ids is not None:
        query = query.in_("product_id", product_ids)

    # Apply pagination
    start = (page - 1) * page_size
    end = start + page_size - 1
    
    # Get data with count
    inventory_response = query.range(start, end).execute()
    
    # Separate query for low stock count (global count for this warehouse)
    # We do not want this to be affected by pagination, but it IS affected by warehouse.
    low_stock_response = supabase.table("inventory_items")\
        .select("*", count="exact", head=True)\
        .eq("warehouse_id", warehouse_id)\
        .lt("quantity_on_hand", 5)\
        .execute()
        
    low_stock_count = low_stock_response.count if low_stock_response.count is not None else 0
    
    items = []
    
    for item in inventory_response.data or []:
        product_data = item.get("products")
        product = None
        if product_data:
            product = ProductResponse(
                id=product_data["id"],
                sku=product_data["sku"],
                name=product_data["name"],
                brand=product_data["brand"],
                category=product_data.get("category"),
                image_url=product_data.get("image_url"),
                retail_price=product_data.get("retail_price"),
                wholesale_price=product_data.get("wholesale_price"),
                cost_price=product_data.get("cost_price"),
            )
        
        inventory_item = InventoryItemResponse(
            id=item["id"],
            warehouse_id=item["warehouse_id"],
            product_id=item["product_id"],
            quantity_on_hand=item["quantity_on_hand"],
            product=product,
        )
        items.append(inventory_item)
    
    total_items = inventory_response.count if inventory_response.count is not None else 0
    
    return InventoryListResponse(
        warehouse_id=warehouse_id,
        warehouse_name=warehouse["name"],
        items=items,
        total_items=total_items,
        page=page,
        page_size=page_size,
        low_stock_count=low_stock_count,
    )


@router.get("/", response_model=List[InventoryListResponse])
async def get_all_inventory(
    user: UserContext = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> List[InventoryListResponse]:
    """
    Get inventory for all accessible warehouses.
    
    - Partners: Returns only their warehouse
    - Admins: Returns all warehouses
    
    Returns:
        List[InventoryListResponse]: List of inventory per warehouse.
    """
    # Get warehouses user has access to
    if user.role == "admin":
        warehouses_response = supabase.table("warehouses").select("*").execute()
    else:
        warehouses_response = supabase.table("warehouses").select("*").eq("id", user.warehouse_id).execute()
    
    results = []
    for warehouse in warehouses_response.data or []:
        # Get inventory for this warehouse
        inventory_response = supabase.table("inventory_items")\
            .select("*, products(*)")\
            .eq("warehouse_id", warehouse["id"])\
            .execute()
        
        items = []
        low_stock_count = 0
        
        for item in inventory_response.data or []:
            product_data = item.get("products")
            product = None
            if product_data:
                product = ProductResponse(
                    id=product_data["id"],
                    sku=product_data["sku"],
                    name=product_data["name"],
                    brand=product_data["brand"],
                    category=product_data.get("category"),
                    image_url=product_data.get("image_url"),
                    retail_price=product_data.get("retail_price"),
                    wholesale_price=product_data.get("wholesale_price"),
                    cost_price=product_data.get("cost_price"),
                )
            
            inventory_item = InventoryItemResponse(
                id=item["id"],
                warehouse_id=item["warehouse_id"],
                product_id=item["product_id"],
                quantity_on_hand=item["quantity_on_hand"],
                product=product,
            )
            items.append(inventory_item)
            
            if item["quantity_on_hand"] < 5:
                low_stock_count += 1
        
        results.append(InventoryListResponse(
            warehouse_id=warehouse["id"],
            warehouse_name=warehouse["name"],
            items=items,
            total_items=len(items),
            low_stock_count=low_stock_count,
        ))
    
    return results
