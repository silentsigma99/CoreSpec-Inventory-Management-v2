"""
Authentication middleware for validating Supabase JWTs.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
from supabase import create_client, Client

from app.core.config import get_settings, Settings


# HTTP Bearer token extraction
security = HTTPBearer()


class UserContext(BaseModel):
    """Authenticated user context extracted from JWT."""
    user_id: str
    email: Optional[str] = None
    role: str = "partner"
    warehouse_id: Optional[str] = None


def get_supabase_client(settings: Settings = Depends(get_settings)) -> Client:
    """Get Supabase client with service role key (bypasses RLS)."""
    return create_client(settings.supabase_url, settings.supabase_service_key)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    settings: Settings = Depends(get_settings),
    supabase: Client = Depends(get_supabase_client),
) -> UserContext:
    """
    Validate JWT token and return user context using Supabase's built-in verification.
    
    Raises:
        HTTPException: If token is invalid or user not found.
    """
    token = credentials.credentials
    
    try:
        # Use Supabase's built-in token verification
        # This validates the JWT and returns user info
        user_response = supabase.auth.get_user(token)
        
        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: user not found",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        user = user_response.user
        user_id = user.id
        email = user.email
        
    except Exception as e:
        error_msg = str(e)
        print(f"Auth Error: {error_msg}")
        
        # Check for specific Supabase errors
        if "Invalid" in error_msg or "expired" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {error_msg}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Fetch user profile and warehouse from database
    try:
        # Get profile with role
        profile_response = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
        profile = profile_response.data
        
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User profile not found",
            )
        
        role = profile.get("role", "partner")
        
        # Get warehouse if user is a partner
        warehouse_id = None
        if role == "partner":
            warehouse_response = supabase.table("warehouses").select("id").eq("manager_id", user_id).single().execute()
            if warehouse_response.data:
                warehouse_id = warehouse_response.data.get("id")
        
        return UserContext(
            user_id=user_id,
            email=email,
            role=role,
            warehouse_id=warehouse_id,
        )
        
    except Exception as e:
        # If it's already an HTTPException, re-raise it
        if isinstance(e, HTTPException):
            raise
        # Otherwise, wrap in a 500 error
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching user data: {str(e)}",
        )


def require_admin(user: UserContext = Depends(get_current_user)) -> UserContext:
    """
    Dependency that requires the user to be an admin.
    
    Raises:
        HTTPException: If user is not an admin.
    """
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


def require_warehouse_access(warehouse_id: str):
    """
    Factory function that creates a dependency requiring access to a specific warehouse.
    
    Usage:
        @router.get("/inventory/{warehouse_id}")
        async def get_inventory(
            warehouse_id: str,
            user: UserContext = Depends(require_warehouse_access(warehouse_id))
        ):
            ...
    """
    async def check_access(user: UserContext = Depends(get_current_user)) -> UserContext:
        # Admins have access to all warehouses
        if user.role == "admin":
            return user
        
        # Partners only have access to their own warehouse
        if user.warehouse_id != warehouse_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this warehouse",
            )
        
        return user
    
    return check_access
