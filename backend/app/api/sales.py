"""
Sales API routes.
Handles recording sales and decrementing inventory.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.core.auth import get_current_user, get_supabase_client, UserContext
from app.models.schemas import SaleRequest, SaleResponse


router = APIRouter(prefix="/api/sales", tags=["sales"])


@router.post("/", response_model=SaleResponse)
async def record_sale(
    sale: SaleRequest,
    user: UserContext = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> SaleResponse:
    """
    Record a sale and decrement inventory.
    
    - Partners can only record sales for their warehouse
    - Admins can record sales for any warehouse
    
    Returns:
        SaleResponse: Details of the recorded sale.
        
    Raises:
        HTTPException: If validation fails or insufficient stock.
    """
    # Check warehouse access
    if user.role != "admin" and user.warehouse_id != sale.warehouse_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only record sales for your own warehouse",
        )
    
    # Validate warehouse exists
    warehouse = supabase.table("warehouses").select("id, name").eq("id", sale.warehouse_id).single().execute()
    if not warehouse.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found",
        )
    
    # Validate product exists and fetch pricing info
    product = supabase.table("products").select("id, name, retail_price, cost_price").eq("id", sale.product_id).single().execute()
    if not product.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )
    
    # Determine final sale price
    # Use provided unit_price, or fall back to product's retail_price
    final_unit_price = sale.unit_price
    if final_unit_price is None:
        final_unit_price = product.data.get("retail_price")
    
    # Validate price against cost (margin protection)
    # Only validate if both unit_price and cost_price are available
    cost_price = product.data.get("cost_price")
    if final_unit_price is not None and cost_price is not None:
        if final_unit_price < cost_price:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Sale price (${final_unit_price:.2f}) cannot be below cost (${cost_price:.2f})",
            )
    
    # Get inventory and validate stock
    inventory = supabase.table("inventory_items")\
        .select("*")\
        .eq("warehouse_id", sale.warehouse_id)\
        .eq("product_id", sale.product_id)\
        .single()\
        .execute()
    
    if not inventory.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Product not found in this warehouse",
        )
    
    current_stock = inventory.data["quantity_on_hand"]
    if current_stock < sale.quantity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient stock. Available: {current_stock}, Requested: {sale.quantity}",
        )
    
    try:
        # 1. Decrement inventory
        new_stock = current_stock - sale.quantity
        supabase.table("inventory_items")\
            .update({"quantity_on_hand": new_stock})\
            .eq("id", inventory.data["id"])\
            .execute()
        
        # 2. Create SALE transaction with unit_price
        transaction = supabase.table("transactions").insert({
            "transaction_type": "SALE",
            "product_id": sale.product_id,
            "from_warehouse_id": sale.warehouse_id,
            "to_warehouse_id": None,
            "quantity": sale.quantity,
            "unit_price": final_unit_price,  # Store actual sale price
            "reference_note": sale.reference_note,
            "created_by": user.user_id,
        }).execute()
        
        return SaleResponse(
            success=True,
            message=f"Sale recorded: {sale.quantity} x {product.data['name']}",
            transaction_id=transaction.data[0]["id"],
            warehouse_id=sale.warehouse_id,
            product_id=sale.product_id,
            quantity=sale.quantity,
            unit_price=final_unit_price,  # Return the actual sale price
            new_stock_level=new_stock,
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record sale: {str(e)}",
        )
