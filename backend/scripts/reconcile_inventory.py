"""
Reconciliation script to add discovered inventory from CSV.
Run from backend directory: python scripts/reconcile_inventory.py

This script will:
1. Read the CSV file with inventory data
2. Match products by SKU (with normalization)
3. ADD quantities to existing inventory in Main Warehouse
4. Create ADJUSTMENT transactions for each item
5. Report any unmatched SKUs
"""

import csv
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# CSV file path
CSV_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "CoreSpec Inventory - December - Sheet1.csv"
)

# Main Warehouse UUID (from seed.sql)
MAIN_WAREHOUSE_ID = "00000000-0000-0000-0000-000000000001"

# Reference note for transactions
REFERENCE_NOTE = "December 2025 Reconciliation"


def normalize_sku(sku: str) -> str:
    """
    Normalize SKU for matching.
    """
    return sku.strip().upper().replace(" ", "-").replace("_", "-")


def create_sku_variations(sku: str) -> list[str]:
    """
    Create multiple SKU variations to try matching.
    """
    normalized = normalize_sku(sku)
    return [
        sku.strip(),
        sku.strip().upper(),
        normalized,
        normalized.replace("-", "_"),
        normalized.replace("-", ""),
    ]


def parse_csv(csv_path: str) -> list[dict]:
    """
    Parse the CSV file with the specific format (headers at row 12, data starts row 13).
    """
    items = []

    with open(csv_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Data starts at row 13 (index 12), columns are at index 3,4,5
    for i, line in enumerate(lines[12:], start=13):  # Skip first 12 rows
        parts = line.strip().split(",")
        if len(parts) >= 6:
            sku = parts[3].strip()
            name = parts[4].strip()
            qty_str = parts[5].strip()

            if not qty_str:
                continue

            try:
                qty = int(qty_str)
            except ValueError:
                continue

            if qty > 0:  # Skip zero quantities
                items.append({
                    "row": i,
                    "sku": sku,
                    "name": name,
                    "quantity": qty,
                })

    return items


def main():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment")
        sys.exit(1)

    print("Connecting to Supabase...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Load all products for SKU matching
    print("Loading products from database...")
    products_response = supabase.table("products").select("id, sku, name").execute()

    # Create multiple lookup keys for each product
    products_by_sku = {}
    for p in products_response.data:
        products_by_sku[p["sku"]] = p
        products_by_sku[p["sku"].upper()] = p
        products_by_sku[normalize_sku(p["sku"])] = p
        products_by_sku[normalize_sku(p["sku"]).replace("-", "_")] = p
        products_by_sku[normalize_sku(p["sku"]).replace("-", "")] = p

    print(f"Loaded {len(products_response.data)} products from database")
    print(f"CSV file: {CSV_PATH}")
    print()

    # Parse CSV
    if not os.path.exists(CSV_PATH):
        print(f"ERROR: CSV file not found at {CSV_PATH}")
        sys.exit(1)

    items = parse_csv(CSV_PATH)
    print(f"Found {len(items)} items with qty > 0 in CSV")
    print()

    reconciled = 0
    skipped = []
    errors = []

    for item in items:
        sku = item["sku"]
        name = item["name"]
        quantity = item["quantity"]
        row = item["row"]

        if not sku:
            skipped.append((row, sku, name, quantity, "Missing SKU"))
            continue

        # Try to match product by SKU variations
        product = None
        for variation in create_sku_variations(sku):
            if variation in products_by_sku:
                product = products_by_sku[variation]
                break

        if not product:
            skipped.append((row, sku, name, quantity, "Product not found"))
            continue

        try:
            # Get or create inventory item
            inventory = supabase.table("inventory_items")\
                .select("*")\
                .eq("warehouse_id", MAIN_WAREHOUSE_ID)\
                .eq("product_id", product["id"])\
                .execute()

            if inventory.data and len(inventory.data) > 0:
                # Update existing inventory - ADD to current quantity
                current_qty = inventory.data[0]["quantity_on_hand"]
                new_qty = current_qty + quantity
                supabase.table("inventory_items")\
                    .update({"quantity_on_hand": new_qty})\
                    .eq("id", inventory.data[0]["id"])\
                    .execute()
                print(f"  ✓ {sku}: {current_qty} + {quantity} = {new_qty}")
            else:
                # Create new inventory item
                new_qty = quantity
                supabase.table("inventory_items").insert({
                    "warehouse_id": MAIN_WAREHOUSE_ID,
                    "product_id": product["id"],
                    "quantity_on_hand": new_qty,
                }).execute()
                print(f"  ✓ {sku}: 0 + {quantity} = {new_qty} (new item)")

            # Create ADJUSTMENT transaction
            supabase.table("transactions").insert({
                "transaction_type": "ADJUSTMENT",
                "product_id": product["id"],
                "from_warehouse_id": None,
                "to_warehouse_id": MAIN_WAREHOUSE_ID,
                "quantity": quantity,
                "reference_note": REFERENCE_NOTE,
            }).execute()

            reconciled += 1

        except Exception as e:
            errors.append(f"Row {row}: Failed to reconcile {sku}: {str(e)}")

    # Print summary
    print()
    print("=" * 50)
    print("RECONCILIATION COMPLETE")
    print("=" * 50)
    print(f"Successfully reconciled: {reconciled} items")
    print(f"Skipped: {len(skipped)} items")
    print(f"Errors: {len(errors)}")

    if skipped:
        print()
        print("SKIPPED ITEMS:")
        print("-" * 50)
        for row, sku, name, qty, reason in skipped:
            print(f"  Row {row}: [{sku or 'NO SKU'}] {name} (qty: {qty}) - {reason}")

    if errors:
        print()
        print("ERRORS:")
        print("-" * 50)
        for error in errors:
            print(f"  • {error}")


if __name__ == "__main__":
    main()
