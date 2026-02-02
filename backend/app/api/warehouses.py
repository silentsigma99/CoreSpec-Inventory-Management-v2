"""
Warehouse API routes.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from typing import List

from app.core.auth import get_current_user, get_supabase_client, UserContext
from app.models.schemas import WarehouseResponse


router = APIRouter(prefix="/api/warehouses", tags=["warehouses"])


@router.get("/", response_model=List[WarehouseResponse])
async def list_warehouses(
    user: UserContext = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> List[WarehouseResponse]:
    """
    List warehouses accessible to the current user.
    
    - Partners: Returns only their assigned warehouse
    - Admins: Returns all warehouses
    
    Returns:
        List[WarehouseResponse]: List of warehouses.
    """
    if user.role == "admin":
        # Admins see all warehouses
        response = supabase.table("warehouses").select("*").order("name").execute()
    else:
        # Partners see only their warehouse
        if not user.warehouse_id:
            return []
        response = supabase.table("warehouses").select("*").eq("id", user.warehouse_id).execute()
    
    warehouses = []
    for w in response.data or []:
        warehouses.append(WarehouseResponse(
            id=w["id"],
            name=w["name"],
            manager_id=w.get("manager_id"),
            created_at=w.get("created_at"),
        ))
    
    return warehouses


@router.get("/{warehouse_id}", response_model=WarehouseResponse)
async def get_warehouse(
    warehouse_id: str,
    user: UserContext = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> WarehouseResponse:
    """
    Get a specific warehouse by ID.
    
    - Partners can only view their own warehouse
    - Admins can view any warehouse
    
    Returns:
        WarehouseResponse: Warehouse details.
    """
    # Check access
    if user.role != "admin" and user.warehouse_id != warehouse_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this warehouse",
        )
    
    response = supabase.table("warehouses").select("*").eq("id", warehouse_id).single().execute()
    
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found",
        )
    
    w = response.data
    return WarehouseResponse(
        id=w["id"],
        name=w["name"],
        manager_id=w.get("manager_id"),
        created_at=w.get("created_at"),
    )
