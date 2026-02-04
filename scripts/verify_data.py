"""
Verify Supabase connectivity and data.
Run from project root: python scripts/verify_data.py

This script tests the connection to Supabase and queries sample data.
"""

import os
from dotenv import load_dotenv
from supabase import create_client

# Load env from .env file in scripts directory or project root
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Error: SUPABASE_URL or SUPABASE_SERVICE_KEY not set in environment.")
    exit(1)

supabase = create_client(url, key)

print("Querying products...")
response = supabase.table("products").select("name, sku, cost_price, wholesale_price, retail_price").limit(5).execute()

if response.data:
    print(f"Found {len(response.data)} products:")
    for p in response.data:
        print(f"SKU: {p.get('sku')}, Cost: {p.get('cost_price')}, Wholesale: {p.get('wholesale_price')}, Retail: {p.get('retail_price')}")
else:
    print("No products found.")
