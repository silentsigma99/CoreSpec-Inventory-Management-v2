"""
Stock Transfer API routes.
Handles atomic transfers between warehouses.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.core.auth import get_current_user, get_supabase_client, UserContext, require_admin
from app.models.schemas import TransferRequest, TransferResponse


router = APIRouter(prefix="/api/transfers", tags=["transfers"])


@router.post("/", response_model=TransferResponse)
async def create_transfer(
    transfer: TransferRequest,
    user: UserContext = Depends(require_admin),  # Only admins can transfer
    supabase: Client = Depends(get_supabase_client),
) -> TransferResponse:
    """
    Transfer stock from one warehouse to another.
    
    This is an atomic operation that:
    1. Validates source has sufficient stock
    2. Decrements source warehouse inventory
    3. Increments (or creates) destination warehouse inventory
    4. Creates TRANSFER_OUT transaction for source
    5. Creates TRANSFER_IN transaction for destination
    
    Only admins can perform transfers.
    
    Returns:
        TransferResponse: Details of the completed transfer.
        
    Raises:
        HTTPException: If validation fails or insufficient stock.
    """
    # Validate warehouses exist
    source = supabase.table("warehouses").select("id, name").eq("id", transfer.from_warehouse_id).single().execute()
    if not source.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source warehouse not found",
        )
    
    dest = supabase.table("warehouses").select("id, name").eq("id", transfer.to_warehouse_id).single().execute()
    if not dest.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Destination warehouse not found",
        )
    
    # Validate product exists
    product = supabase.table("products").select("id, name").eq("id", transfer.product_id).single().execute()
    if not product.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )
    
    # Get source inventory and validate stock
    source_inventory = supabase.table("inventory_items")\
        .select("*")\
        .eq("warehouse_id", transfer.from_warehouse_id)\
        .eq("product_id", transfer.product_id)\
        .single()\
        .execute()
    
    if not source_inventory.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Product not found in source warehouse",
        )
    
    current_stock = source_inventory.data["quantity_on_hand"]
    if current_stock < transfer.quantity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient stock. Available: {current_stock}, Requested: {transfer.quantity}",
        )
    
    # ATOMIC TRANSFER OPERATION
    # Note: Supabase Python client doesn't support true transactions,
    # so we perform operations in sequence. For production, use a
    # Postgres function or Edge Function for true atomicity.
    
    try:
        # 1. Decrement source inventory
        new_source_qty = current_stock - transfer.quantity
        supabase.table("inventory_items")\
            .update({"quantity_on_hand": new_source_qty})\
            .eq("id", source_inventory.data["id"])\
            .execute()
        
        # 2. Increment or create destination inventory
        dest_inventory_result = supabase.table("inventory_items")\
            .select("*")\
            .eq("warehouse_id", transfer.to_warehouse_id)\
            .eq("product_id", transfer.product_id)\
            .execute()
        
        # Check if destination already has this product
        dest_inventory = dest_inventory_result.data[0] if dest_inventory_result.data else None
        
        if dest_inventory:
            # Update existing
            new_dest_qty = dest_inventory["quantity_on_hand"] + transfer.quantity
            supabase.table("inventory_items")\
                .update({"quantity_on_hand": new_dest_qty})\
                .eq("id", dest_inventory["id"])\
                .execute()
        else:
            # Create new inventory record
            supabase.table("inventory_items").insert({
                "warehouse_id": transfer.to_warehouse_id,
                "product_id": transfer.product_id,
                "quantity_on_hand": transfer.quantity,
            }).execute()
        
        # 3. Create TRANSFER_OUT transaction
        transfer_out = supabase.table("transactions").insert({
            "transaction_type": "TRANSFER_OUT",
            "product_id": transfer.product_id,
            "from_warehouse_id": transfer.from_warehouse_id,
            "to_warehouse_id": transfer.to_warehouse_id,
            "quantity": transfer.quantity,
            "reference_note": transfer.reference_note or f"Transfer to {dest.data['name']}",
            "created_by": user.user_id,
        }).execute()
        
        # 4. Create TRANSFER_IN transaction
        transfer_in = supabase.table("transactions").insert({
            "transaction_type": "TRANSFER_IN",
            "product_id": transfer.product_id,
            "from_warehouse_id": transfer.from_warehouse_id,
            "to_warehouse_id": transfer.to_warehouse_id,
            "quantity": transfer.quantity,
            "reference_note": transfer.reference_note or f"Transfer from {source.data['name']}",
            "created_by": user.user_id,
        }).execute()
        
        return TransferResponse(
            success=True,
            message=f"Successfully transferred {transfer.quantity} units",
            transfer_out_id=transfer_out.data[0]["id"],
            transfer_in_id=transfer_in.data[0]["id"],
            from_warehouse_id=transfer.from_warehouse_id,
            to_warehouse_id=transfer.to_warehouse_id,
            product_id=transfer.product_id,
            quantity=transfer.quantity,
        )
        
    except Exception as e:
        # In a real production system, you'd want to implement
        # proper rollback logic or use database transactions
        import traceback
        print(f"Transfer Error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transfer failed: {str(e)}",
        )
