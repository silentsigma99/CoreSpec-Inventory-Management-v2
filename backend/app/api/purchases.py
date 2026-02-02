"""
Purchases API routes.
Handles recording purchases (restocks) and incrementing inventory.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.core.auth import get_current_user, get_supabase_client, UserContext
from app.models.schemas import PurchaseRequest, PurchaseResponse


router = APIRouter(prefix="/api/purchases", tags=["purchases"])


@router.post("/", response_model=PurchaseResponse)
async def record_purchase(
    purchase: PurchaseRequest,
    user: UserContext = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> PurchaseResponse:
    """
    Record a purchase and increment inventory.

    - Admin only (purchases are typically made by admin at main warehouse)
    - Creates inventory_item if it doesn't exist for this warehouse/product
    - Creates RESTOCK transaction with unit_price storing cost

    Returns:
        PurchaseResponse: Details of the recorded purchase.

    Raises:
        HTTPException: If validation fails or user not authorized.
    """
    # Only admins can record purchases
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can record purchases",
        )

    # Validate warehouse exists
    warehouse = supabase.table("warehouses").select("id, name").eq("id", purchase.warehouse_id).execute()
    if not warehouse.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found",
        )

    # Validate product exists and fetch cost info
    product = supabase.table("products").select("id, name, cost_price").eq("id", purchase.product_id).execute()
    if not product.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    # Determine final cost
    # Use provided unit_cost, or fall back to product's cost_price
    final_unit_cost = purchase.unit_cost
    if final_unit_cost is None:
        final_unit_cost = product.data[0].get("cost_price")

    try:
        # Check if inventory item exists
        inventory = supabase.table("inventory_items")\
            .select("*")\
            .eq("warehouse_id", purchase.warehouse_id)\
            .eq("product_id", purchase.product_id)\
            .execute()

        if inventory.data and len(inventory.data) > 0:
            # Update existing inventory
            current_stock = inventory.data[0]["quantity_on_hand"]
            new_stock = current_stock + purchase.quantity
            supabase.table("inventory_items")\
                .update({"quantity_on_hand": new_stock})\
                .eq("id", inventory.data[0]["id"])\
                .execute()
        else:
            # Create new inventory item
            new_stock = purchase.quantity
            supabase.table("inventory_items").insert({
                "warehouse_id": purchase.warehouse_id,
                "product_id": purchase.product_id,
                "quantity_on_hand": new_stock,
            }).execute()

        # Create RESTOCK transaction
        transaction = supabase.table("transactions").insert({
            "transaction_type": "RESTOCK",
            "product_id": purchase.product_id,
            "from_warehouse_id": None,  # No source for purchases
            "to_warehouse_id": purchase.warehouse_id,  # Destination is the warehouse
            "quantity": purchase.quantity,
            "unit_price": final_unit_cost,  # Store cost in unit_price field
            "reference_note": purchase.reference_note,
            "created_by": user.user_id,
        }).execute()

        return PurchaseResponse(
            success=True,
            message=f"Purchase recorded: {purchase.quantity} x {product.data[0]['name']}",
            transaction_id=transaction.data[0]["id"],
            warehouse_id=purchase.warehouse_id,
            product_id=purchase.product_id,
            quantity=purchase.quantity,
            unit_cost=final_unit_cost,
            new_stock_level=new_stock,
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record purchase: {str(e)}",
        )
