"""
Products API routes.
"""

from fastapi import APIRouter, Depends
from supabase import Client

from app.core.auth import get_current_user, get_supabase_client, UserContext
from app.models.schemas import BrandsResponse


router = APIRouter(prefix="/api", tags=["products"])


@router.get("/brands", response_model=BrandsResponse)
async def get_brands(
    user: UserContext = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> BrandsResponse:
    """
    Get a sorted list of all unique brand names in the product catalog.

    Any authenticated user (admin or partner) may call this endpoint.

    Returns:
        BrandsResponse: Alphabetically sorted list of brand names.
    """
    response = supabase.table("products").select("brand").execute()

    # Deduplicate and sort in Python -- explicit and safe regardless of
    # whether the underlying table has NULL brand values (schema says NOT NULL,
    # but defensive here costs nothing).
    brands = sorted({row["brand"] for row in (response.data or []) if row.get("brand")})

    return BrandsResponse(brands=brands)
