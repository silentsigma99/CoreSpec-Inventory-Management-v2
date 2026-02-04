"""
Import purchases from CSV file.
Run from project root: python scripts/import_purchases.py <csv_file> [purchase_date]

Examples:
  python scripts/import_purchases.py "./purchases.csv" "January 31, 2026"
  python scripts/import_purchases.py "./Gemini Export.csv"

This script will:
1. Read the CSV file with purchase data
2. Match products by SKU (with normalization)
3. Increment inventory in Main Warehouse
4. Create RESTOCK transactions for each item
5. Report any unmatched SKUs
"""

import csv
import os
import sys
from datetime import datetime

from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from .env file in scripts directory or project root
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()  # Also try project root

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# Main Warehouse UUID (from seed.sql)
MAIN_WAREHOUSE_ID = "00000000-0000-0000-0000-000000000001"


def normalize_sku(sku: str) -> str:
    """
    Normalize SKU for matching.
    Handles variations like:
    - TVD_109_16 vs TVD-109-16
    - TVD 104 16 vs TVD_104_16
    - Case differences
    """
    return sku.strip().upper().replace(" ", "-").replace("_", "-")


def create_sku_variations(sku: str) -> list[str]:
    """
    Create multiple SKU variations to try matching.
    """
    normalized = normalize_sku(sku)
    return [
        sku.strip(),  # Original
        sku.strip().upper(),  # Uppercase original
        normalized,  # Normalized (dashes)
        normalized.replace("-", "_"),  # With underscores
        normalized.replace("-", ""),  # No separators
    ]


def main():
    # Parse command line arguments
    if len(sys.argv) < 2:
        print("Usage: python scripts/import_purchases.py <csv_file> [purchase_date]")
        print()
        print("Arguments:")
        print("  csv_file      Path to CSV file (required)")
        print("  purchase_date Date for reference note (optional, defaults to today)")
        print()
        print("Examples:")
        print('  python scripts/import_purchases.py "./purchases.csv" "January 31, 2026"')
        print('  python scripts/import_purchases.py "./Gemini Export.csv"')
        sys.exit(1)

    csv_path = sys.argv[1]
    purchase_date = sys.argv[2] if len(sys.argv) > 2 else datetime.now().strftime("%B %d, %Y")

    # Handle relative paths
    if not os.path.isabs(csv_path):
        csv_path = os.path.join(os.getcwd(), csv_path)

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment")
        sys.exit(1)

    print(f"Connecting to Supabase...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Load all products for SKU matching
    print("Loading products from database...")
    products_response = supabase.table("products").select("id, sku, name, cost_price").execute()

    # Create multiple lookup keys for each product
    products_by_sku = {}
    for p in products_response.data:
        # Add original and normalized versions
        products_by_sku[p["sku"]] = p
        products_by_sku[p["sku"].upper()] = p
        products_by_sku[normalize_sku(p["sku"])] = p
        products_by_sku[normalize_sku(p["sku"]).replace("-", "_")] = p
        products_by_sku[normalize_sku(p["sku"]).replace("-", "")] = p

    print(f"Loaded {len(products_response.data)} products from database")
    print(f"CSV file: {csv_path}")
    print(f"Purchase date: {purchase_date}")
    print()

    # Read CSV
    if not os.path.exists(csv_path):
        print(f"ERROR: CSV file not found at {csv_path}")
        sys.exit(1)

    imported = 0
    skipped = []
    errors = []

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        for row_num, row in enumerate(reader, start=2):  # Start at 2 (header is row 1)
            sku = row.get("Product Code", "").strip()
            qty_str = row.get("Qty", "0").strip()
            description = row.get("Item Description", "").strip()

            if not sku or not qty_str:
                continue

            try:
                quantity = int(qty_str)
            except ValueError:
                errors.append(f"Row {row_num}: Invalid quantity '{qty_str}' for {sku}")
                continue

            if quantity <= 0:
                continue

            # Try to match product by SKU variations
            product = None
            for variation in create_sku_variations(sku):
                if variation in products_by_sku:
                    product = products_by_sku[variation]
                    break

            if not product:
                skipped.append((sku, description, quantity))
                continue

            try:
                # Get or create inventory item
                inventory = supabase.table("inventory_items")\
                    .select("*")\
                    .eq("warehouse_id", MAIN_WAREHOUSE_ID)\
                    .eq("product_id", product["id"])\
                    .execute()

                if inventory.data and len(inventory.data) > 0:
                    # Update existing inventory
                    new_qty = inventory.data[0]["quantity_on_hand"] + quantity
                    supabase.table("inventory_items")\
                        .update({"quantity_on_hand": new_qty})\
                        .eq("id", inventory.data[0]["id"])\
                        .execute()
                else:
                    # Create new inventory item
                    new_qty = quantity
                    supabase.table("inventory_items").insert({
                        "warehouse_id": MAIN_WAREHOUSE_ID,
                        "product_id": product["id"],
                        "quantity_on_hand": new_qty,
                    }).execute()

                # Create RESTOCK transaction
                supabase.table("transactions").insert({
                    "transaction_type": "RESTOCK",
                    "product_id": product["id"],
                    "from_warehouse_id": None,
                    "to_warehouse_id": MAIN_WAREHOUSE_ID,
                    "quantity": quantity,
                    "unit_price": product.get("cost_price"),  # Use product cost
                    "reference_note": f"Purchase: {purchase_date} - {description}",
                }).execute()

                imported += 1
                print(f"  + Imported: {sku} -> {product['name']} x {quantity}")

            except Exception as e:
                errors.append(f"Row {row_num}: Failed to import {sku}: {str(e)}")

    # Print summary
    print()
    print("=" * 50)
    print("IMPORT COMPLETE")
    print("=" * 50)
    print(f"Successfully imported: {imported} items")
    print(f"Skipped (product not found): {len(skipped)} items")
    print(f"Errors: {len(errors)}")

    if skipped:
        print()
        print("SKIPPED ITEMS (products not in database):")
        print("-" * 50)
        for sku, desc, qty in skipped:
            print(f"  * {sku}: {desc} (qty: {qty})")
        print()
        print("To import these, first add the products to the database,")
        print("then re-run this script.")

    if errors:
        print()
        print("ERRORS:")
        print("-" * 50)
        for error in errors:
            print(f"  * {error}")


if __name__ == "__main__":
    main()
