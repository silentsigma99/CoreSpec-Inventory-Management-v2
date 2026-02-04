"""
CoreSpec Inventory System - FastAPI Backend
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

# Import routers
from app.api.auth import router as auth_router
from app.api.inventory import router as inventory_router
from app.api.warehouses import router as warehouses_router
from app.api.transfers import router as transfers_router
from app.api.sales import router as sales_router
from app.api.purchases import router as purchases_router
from app.api.products import router as products_router
from app.api.transactions import router as transactions_router

# Create FastAPI app
app = FastAPI(
    title="CoreSpec Inventory API",
    description="Inventory management system for CoreSpec Distribution",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS configuration
allowed_origins = [
    "http://localhost:3000",
    os.getenv("FRONTEND_URL", "http://localhost:3000"),
]
# Filter out empty strings and duplicates
allowed_origins = list(set(origin for origin in allowed_origins if origin))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router)
app.include_router(inventory_router)
app.include_router(warehouses_router)
app.include_router(transfers_router)
app.include_router(sales_router)
app.include_router(purchases_router)
app.include_router(products_router)
app.include_router(transactions_router)


@app.get("/")
async def root():
    """Root endpoint - API info."""
    return {
        "name": "CoreSpec Inventory API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}
