"""
Import purchases from CSV file.
Run from project root: python scripts/import_purchases.py <csv_file> [purchase_date]

Examples:
  python scripts/import_purchases.py "./purchases.csv" "January 31, 2026"
  python scripts/import_purchases.py "./Gemini Export.csv"
  python scripts/import_purchases.py "./purchases.csv" --po-number PO-123 --vendor "Acme Corp" --bill-date 2026-01-31

This script will:
1. Read the CSV file with purchase data
2. Create a purchase batch (if batch metadata provided)
3. Match products by SKU (with normalization)
4. Increment inventory in Main Warehouse
5. Create RESTOCK transactions for each item (linked to batch)
6. Report any unmatched SKUs

Batch metadata can be provided via:
- CSV columns: PO Number, Vendor Bill Number, Vendor Name, Bill Date (from first row)
- Command-line: --po-number, --vendor-bill, --vendor-name, --bill-date
"""

import argparse
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


def parse_date(s: str) -> str | None:
    """Parse date string to YYYY-MM-DD format."""
    if not s or not s.strip():
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Import purchases from CSV file into Main Warehouse."
    )
    parser.add_argument("csv_file", help="Path to CSV file")
    parser.add_argument(
        "purchase_date",
        nargs="?",
        default=datetime.now().strftime("%B %d, %Y"),
        help="Date for reference note (default: today)",
    )
    parser.add_argument("--po-number", help="Purchase order number for batch")
    parser.add_argument("--vendor-bill", help="Vendor bill number for batch")
    parser.add_argument("--vendor-name", "--vendor", dest="vendor_name", help="Vendor/supplier name for batch")
    parser.add_argument("--bill-date", help="Bill date (YYYY-MM-DD or similar) for batch")
    args = parser.parse_args()

    csv_path = args.csv_file
    purchase_date = args.purchase_date

    batch_meta = {
        "po_number": args.po_number,
        "vendor_bill_number": args.vendor_bill,
        "vendor_name": args.vendor_name,
        "bill_date": parse_date(args.bill_date) if args.bill_date else None,
    }

    # Handle relative paths
    if not os.path.isabs(csv_path):
        csv_path = os.path.join(os.getcwd(), csv_path)

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment")
        sys.exit(1)

    print("Connecting to Supabase...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    batch_id = None
    if any(batch_meta.values()):
        print("Creating purchase batch...")
        batch_row = {
            "warehouse_id": MAIN_WAREHOUSE_ID,
            "po_number": batch_meta.get("po_number"),
            "vendor_bill_number": batch_meta.get("vendor_bill_number"),
            "vendor_name": batch_meta.get("vendor_name"),
            "bill_date": batch_meta.get("bill_date"),
        }
        batch_resp = supabase.table("purchase_batches").insert(batch_row).execute()
        if batch_resp.data and len(batch_resp.data) > 0:
            batch_id = batch_resp.data[0]["id"]
            print(f"  Batch created: {batch_id}")

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

            if row_num == 2 and not batch_id and any(
                row.get(k) for k in ("PO Number", "Vendor Bill Number", "Vendor Name", "Bill Date")
            ):
                batch_row = {
                    "warehouse_id": MAIN_WAREHOUSE_ID,
                    "po_number": row.get("PO Number", "").strip() or None,
                    "vendor_bill_number": row.get("Vendor Bill Number", "").strip() or None,
                    "vendor_name": row.get("Vendor Name", "").strip() or None,
                    "bill_date": parse_date(row.get("Bill Date", "")) if row.get("Bill Date") else None,
                }
                if any(batch_row.get(k) for k in ("po_number", "vendor_bill_number", "vendor_name", "bill_date")):
                    batch_resp = supabase.table("purchase_batches").insert(batch_row).execute()
                    if batch_resp.data and len(batch_resp.data) > 0:
                        batch_id = batch_resp.data[0]["id"]
                        print(f"  Batch created from CSV: {batch_id}")

            try:
                quantity = int(qty_str)
            except ValueError:
                errors.append(f"Row {row_num}: Invalid quantity '{qty_str}' for {sku}")
                continue

            if quantity <= 0:
                continue

            product = None
            for variation in create_sku_variations(sku):
                if variation in products_by_sku:
                    product = products_by_sku[variation]
                    break

            if not product:
                skipped.append((sku, description, quantity))
                continue

            try:
                inventory = supabase.table("inventory_items")\
                    .select("*")\
                    .eq("warehouse_id", MAIN_WAREHOUSE_ID)\
                    .eq("product_id", product["id"])\
                    .execute()

                if inventory.data and len(inventory.data) > 0:
                    new_qty = inventory.data[0]["quantity_on_hand"] + quantity
                    supabase.table("inventory_items")\
                        .update({"quantity_on_hand": new_qty})\
                        .eq("id", inventory.data[0]["id"])\
                        .execute()
                else:
                    new_qty = quantity
                    supabase.table("inventory_items").insert({
                        "warehouse_id": MAIN_WAREHOUSE_ID,
                        "product_id": product["id"],
                        "quantity_on_hand": new_qty,
                    }).execute()

                tx_payload = {
                    "transaction_type": "RESTOCK",
                    "product_id": product["id"],
                    "from_warehouse_id": None,
                    "to_warehouse_id": MAIN_WAREHOUSE_ID,
                    "quantity": quantity,
                    "unit_price": product.get("cost_price"),
                    "reference_note": f"Purchase: {purchase_date} - {description}",
                }
                if batch_id:
                    tx_payload["batch_id"] = batch_id

                supabase.table("transactions").insert(tx_payload).execute()

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
