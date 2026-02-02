"""
Authentication API routes.
"""

from fastapi import APIRouter, Depends
from supabase import Client

from app.core.auth import get_current_user, get_supabase_client, UserContext
from app.models.schemas import ProfileWithWarehouse


router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/me", response_model=ProfileWithWarehouse)
async def get_current_user_profile(
    user: UserContext = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> ProfileWithWarehouse:
    """
    Get the current authenticated user's profile with warehouse info.
    
    Returns:
        ProfileWithWarehouse: User profile including role and warehouse assignment.
    """
    # Get warehouse name if user has one
    warehouse_name = None
    if user.warehouse_id:
        warehouse_response = supabase.table("warehouses").select("name").eq("id", user.warehouse_id).single().execute()
        if warehouse_response.data:
            warehouse_name = warehouse_response.data.get("name")
    
    return ProfileWithWarehouse(
        id=user.user_id,
        role=user.role,
        full_name=user.email,  # Will be overwritten if profile has full_name
        warehouse_id=user.warehouse_id,
        warehouse_name=warehouse_name,
    )
