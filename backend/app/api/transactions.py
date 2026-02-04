"""
Transaction History API routes.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from supabase import Client
from typing import Optional, List

from app.core.auth import get_current_user, get_supabase_client, UserContext
from app.models.schemas import (
    TransactionResponse,
    TransactionListResponse,
    ProductResponse,
    WarehouseResponse,
    TransactionType,
)


router = APIRouter(prefix="/api/transactions", tags=["transactions"])


@router.get("/{warehouse_id}", response_model=TransactionListResponse)
async def get_warehouse_transactions(
    warehouse_id: str,
    transaction_type: Optional[TransactionType] = Query(None, description="Filter by transaction type"),
    brand: Optional[str] = Query(None, description="Filter by product brand"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
    user: UserContext = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> TransactionListResponse:
    """
    Get transaction history for a warehouse.

    - Partners can only view transactions for their warehouse
    - Admins can view transactions for any warehouse
    - Supports filtering by transaction type and/or product brand
    - Paginated results

    Returns:
        TransactionListResponse: Paginated list of transactions.
    """
    # Check access
    if user.role != "admin" and user.warehouse_id != warehouse_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this warehouse's transactions",
        )
    
    # Validate warehouse exists
    warehouse = supabase.table("warehouses").select("id").eq("id", warehouse_id).single().execute()
    if not warehouse.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found",
        )
    
    # If brand filter is provided, resolve the matching product IDs first.
    # Returns empty results immediately when no products match the brand.
    brand_product_ids = None
    if brand:
        brand_response = supabase.table("products")\
            .select("id")\
            .eq("brand", brand)\
            .execute()
        brand_product_ids = [p["id"] for p in (brand_response.data or [])]
        if not brand_product_ids:
            return TransactionListResponse(items=[], total=0, page=page, page_size=page_size)

    # Build query - transactions where this warehouse is source OR destination
    query = supabase.table("transactions")\
        .select("*, products(*)")\
        .or_(f"from_warehouse_id.eq.{warehouse_id},to_warehouse_id.eq.{warehouse_id}")

    # Filter by type if specified
    if transaction_type:
        query = query.eq("transaction_type", transaction_type.value)

    # Apply brand filter to data query
    if brand_product_ids is not None:
        query = query.in_("product_id", brand_product_ids)

    # Get total count (must mirror all filters applied to the data query)
    count_query = supabase.table("transactions")\
        .select("id", count="exact")\
        .or_(f"from_warehouse_id.eq.{warehouse_id},to_warehouse_id.eq.{warehouse_id}")

    if transaction_type:
        count_query = count_query.eq("transaction_type", transaction_type.value)

    if brand_product_ids is not None:
        count_query = count_query.in_("product_id", brand_product_ids)

    count_response = count_query.execute()
    total = count_response.count or 0
    
    # Apply pagination and ordering
    offset = (page - 1) * page_size
    query = query.order("created_at", desc=True).range(offset, offset + page_size - 1)
    
    response = query.execute()
    
    # Get warehouse names for display
    warehouse_cache = {}
    
    async def get_warehouse_name(wid: str) -> Optional[WarehouseResponse]:
        if not wid:
            return None
        if wid not in warehouse_cache:
            w = supabase.table("warehouses").select("*").eq("id", wid).single().execute()
            if w.data:
                warehouse_cache[wid] = WarehouseResponse(
                    id=w.data["id"],
                    name=w.data["name"],
                    manager_id=w.data.get("manager_id"),
                )
            else:
                warehouse_cache[wid] = None
        return warehouse_cache[wid]
    
    items = []
    for t in response.data or []:
        product_data = t.get("products")
        product = None
        if product_data:
            product = ProductResponse(
                id=product_data["id"],
                sku=product_data["sku"],
                name=product_data["name"],
                brand=product_data["brand"],
                category=product_data.get("category"),
                retail_price=product_data.get("retail_price"),
            )
        
        # Get warehouse info
        from_warehouse = None
        to_warehouse = None
        
        if t.get("from_warehouse_id"):
            if t["from_warehouse_id"] not in warehouse_cache:
                w = supabase.table("warehouses").select("*").eq("id", t["from_warehouse_id"]).single().execute()
                if w.data:
                    warehouse_cache[t["from_warehouse_id"]] = WarehouseResponse(
                        id=w.data["id"],
                        name=w.data["name"],
                        manager_id=w.data.get("manager_id"),
                    )
            from_warehouse = warehouse_cache.get(t["from_warehouse_id"])
        
        if t.get("to_warehouse_id"):
            if t["to_warehouse_id"] not in warehouse_cache:
                w = supabase.table("warehouses").select("*").eq("id", t["to_warehouse_id"]).single().execute()
                if w.data:
                    warehouse_cache[t["to_warehouse_id"]] = WarehouseResponse(
                        id=w.data["id"],
                        name=w.data["name"],
                        manager_id=w.data.get("manager_id"),
                    )
            to_warehouse = warehouse_cache.get(t["to_warehouse_id"])
        
        items.append(TransactionResponse(
            id=t["id"],
            transaction_type=t["transaction_type"],
            product_id=t["product_id"],
            from_warehouse_id=t.get("from_warehouse_id"),
            to_warehouse_id=t.get("to_warehouse_id"),
            quantity=t["quantity"],
            reference_note=t.get("reference_note"),
            created_by=t.get("created_by"),
            created_at=t["created_at"],
            product=product,
            from_warehouse=from_warehouse,
            to_warehouse=to_warehouse,
        ))
    
    return TransactionListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )
