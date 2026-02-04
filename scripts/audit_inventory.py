"""
Inventory Audit Script - Compare CSV imports vs database state.
Run from project root: python scripts/audit_inventory.py [csv_files...]

Examples:
  python scripts/audit_inventory.py                           # Audit DB only (no CSV comparison)
  python scripts/audit_inventory.py "./purchases.csv"        # Compare one CSV
  python scripts/audit_inventory.py "./file1.csv" "./file2.csv"  # Compare multiple CSVs

This script will:
1. Parse provided CSV files (Gemini Export format)
2. Query the database for current inventory quantities
3. Query transaction history to trace all stock changes
4. Generate a comprehensive audit report showing discrepancies
"""

import csv
import os
import sys
from datetime import datetime
from collections import defaultdict

from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from .env file in scripts directory or project root
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()  # Also try project root

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# Main Warehouse UUID
MAIN_WAREHOUSE_ID = "00000000-0000-0000-0000-000000000001"


def normalize_sku(sku: str) -> str:
    """Normalize SKU for matching."""
    return sku.strip().upper().replace(" ", "-").replace("_", "-")


def create_sku_variations(sku: str) -> list[str]:
    """Create multiple SKU variations to try matching."""
    normalized = normalize_sku(sku)
    return [
        sku.strip(),
        sku.strip().upper(),
        normalized,
        normalized.replace("-", "_"),
        normalized.replace("-", ""),
    ]


def parse_gemini_csv(csv_path: str) -> list[dict]:
    """Parse the Gemini Export CSV (standard format with headers)."""
    items = []

    if not os.path.exists(csv_path):
        print(f"WARNING: Gemini CSV not found at {csv_path}")
        return items

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row_num, row in enumerate(reader, start=2):
            sku = row.get("Product Code", "").strip()
            qty_str = row.get("Qty", "0").strip()
            description = row.get("Item Description", "").strip()

            if not sku or not qty_str:
                continue

            try:
                qty = int(qty_str)
            except ValueError:
                continue

            if qty > 0:
                items.append({
                    "source": "Gemini Export (Feb 4)",
                    "row": row_num,
                    "sku": sku,
                    "name": description,
                    "quantity": qty,
                })

    return items


def parse_december_csv(csv_path: str) -> list[dict]:
    """Parse the December inventory CSV (special format with headers at row 12)."""
    items = []

    if not os.path.exists(csv_path):
        print(f"WARNING: December CSV not found at {csv_path}")
        return items

    with open(csv_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Data starts at row 13 (index 12), columns are at index 3,4,5
    for i, line in enumerate(lines[12:], start=13):
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

            if qty > 0:
                items.append({
                    "source": "December Reconciliation",
                    "row": i,
                    "sku": sku,
                    "name": name,
                    "quantity": qty,
                })

    return items


def match_sku_to_product(sku: str, products_by_sku: dict) -> dict | None:
    """Try to match a SKU to a product using variations."""
    for variation in create_sku_variations(sku):
        if variation in products_by_sku:
            return products_by_sku[variation]
    return None


def main():
    # Parse command line arguments for CSV files
    csv_files = []
    for arg in sys.argv[1:]:
        csv_path = arg
        if not os.path.isabs(csv_path):
            csv_path = os.path.join(os.getcwd(), csv_path)
        if os.path.exists(csv_path):
            csv_files.append(csv_path)
        else:
            print(f"WARNING: CSV file not found: {csv_path}")

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment")
        sys.exit(1)

    print("=" * 70)
    print("INVENTORY AUDIT REPORT")
    print(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    print()

    # Connect to Supabase
    print("Connecting to Supabase...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # =========================================================================
    # STEP 1: Load all products
    # =========================================================================
    print("Loading products from database...")
    products_response = supabase.table("products").select("id, sku, name").execute()

    products_by_id = {p["id"]: p for p in products_response.data}
    products_by_sku = {}
    for p in products_response.data:
        products_by_sku[p["sku"]] = p
        products_by_sku[p["sku"].upper()] = p
        products_by_sku[normalize_sku(p["sku"])] = p
        products_by_sku[normalize_sku(p["sku"]).replace("-", "_")] = p
        products_by_sku[normalize_sku(p["sku"]).replace("-", "")] = p

    print(f"  Found {len(products_response.data)} products")

    # =========================================================================
    # STEP 2: Load current inventory
    # =========================================================================
    print("Loading current inventory...")
    inventory_response = supabase.table("inventory_items")\
        .select("product_id, quantity_on_hand")\
        .eq("warehouse_id", MAIN_WAREHOUSE_ID)\
        .execute()

    current_inventory = {item["product_id"]: item["quantity_on_hand"]
                         for item in inventory_response.data}
    print(f"  Found {len(inventory_response.data)} inventory items in Main Warehouse")

    # =========================================================================
    # STEP 3: Load all transactions for Main Warehouse
    # =========================================================================
    print("Loading transaction history...")

    # Get inbound transactions (RESTOCK, ADJUSTMENT, TRANSFER_IN)
    inbound_response = supabase.table("transactions")\
        .select("product_id, transaction_type, quantity, reference_note, created_at")\
        .eq("to_warehouse_id", MAIN_WAREHOUSE_ID)\
        .execute()

    # Get outbound transactions (SALE, TRANSFER_OUT)
    outbound_response = supabase.table("transactions")\
        .select("product_id, transaction_type, quantity, reference_note, created_at")\
        .eq("from_warehouse_id", MAIN_WAREHOUSE_ID)\
        .execute()

    print(f"  Found {len(inbound_response.data)} inbound transactions")
    print(f"  Found {len(outbound_response.data)} outbound transactions")

    # Aggregate transactions per product
    tx_summary = defaultdict(lambda: {
        "restock": 0, "adjustment": 0, "transfer_in": 0,
        "sale": 0, "transfer_out": 0,
        "restock_txns": [], "adjustment_txns": [],
    })

    for tx in inbound_response.data:
        pid = tx["product_id"]
        qty = tx["quantity"]
        tx_type = tx["transaction_type"]

        if tx_type == "RESTOCK":
            tx_summary[pid]["restock"] += qty
            tx_summary[pid]["restock_txns"].append(tx)
        elif tx_type == "ADJUSTMENT":
            tx_summary[pid]["adjustment"] += qty
            tx_summary[pid]["adjustment_txns"].append(tx)
        elif tx_type == "TRANSFER_IN":
            tx_summary[pid]["transfer_in"] += qty

    for tx in outbound_response.data:
        pid = tx["product_id"]
        qty = tx["quantity"]
        tx_type = tx["transaction_type"]

        if tx_type == "SALE":
            tx_summary[pid]["sale"] += qty
        elif tx_type == "TRANSFER_OUT":
            tx_summary[pid]["transfer_out"] += qty

    # =========================================================================
    # STEP 4: Parse CSV files
    # =========================================================================
    print("Parsing CSV files...")

    all_csv_items = []
    if csv_files:
        for csv_path in csv_files:
            items = parse_gemini_csv(csv_path)
            print(f"  {os.path.basename(csv_path)}: {len(items)} items with qty > 0")
            all_csv_items.extend(items)
    else:
        print("  No CSV files provided - will show database inventory only")

    # Calculate expected quantities from CSVs
    csv_expected = defaultdict(lambda: {"total": 0, "matched_product": None, "sources": []})
    csv_unmatched = []

    for item in all_csv_items:
        if not item["sku"]:
            csv_unmatched.append({**item, "reason": "Missing SKU"})
            continue
        product = match_sku_to_product(item["sku"], products_by_sku)
        if product:
            csv_expected[product["id"]]["total"] += item["quantity"]
            csv_expected[product["id"]]["matched_product"] = product
            csv_expected[product["id"]]["sources"].append(f"{item['source']}: {item['quantity']}")
        else:
            csv_unmatched.append(item)

    # =========================================================================
    # STEP 5: Generate audit report
    # =========================================================================
    print()
    print("=" * 70)
    print("SECTION 1: UNMATCHED CSV ITEMS (Skipped during import)")
    print("=" * 70)

    if csv_unmatched:
        print(f"\n{len(csv_unmatched)} items from CSV could not be matched to products:\n")
        for item in csv_unmatched:
            reason = item.get("reason", "SKU not in database")
            print(f"  [{item['source']}] Row {item['row']}: SKU='{item['sku'] or '(empty)'}' "
                  f"Name='{item['name']}' Qty={item['quantity']} - {reason}")
    else:
        print("\nAll CSV items matched successfully!")

    print()
    print("=" * 70)
    print("SECTION 2: INVENTORY COMPARISON")
    print("=" * 70)
    print()
    print("Comparing: CSV Expected vs Transaction Totals vs Current Inventory")
    print()
    print(f"{'Product':<45} {'CSV':>6} {'TX+':>6} {'TX-':>6} {'NET':>6} {'DB':>6} {'DIFF':>6}")
    print("-" * 85)

    discrepancies = []

    # Get all product IDs that appear in CSVs, transactions, or inventory
    all_product_ids = set(csv_expected.keys()) | set(tx_summary.keys()) | set(current_inventory.keys())

    for pid in sorted(all_product_ids):
        product = products_by_id.get(pid)
        if not product:
            continue

        csv_total = csv_expected[pid]["total"]
        tx_in = tx_summary[pid]["restock"] + tx_summary[pid]["adjustment"] + tx_summary[pid]["transfer_in"]
        tx_out = tx_summary[pid]["sale"] + tx_summary[pid]["transfer_out"]
        tx_net = tx_in - tx_out
        db_qty = current_inventory.get(pid, 0)

        # Check for discrepancies
        diff_csv_vs_db = db_qty - csv_total
        diff_tx_vs_db = db_qty - tx_net

        has_issue = (csv_total > 0 and diff_csv_vs_db != 0) or diff_tx_vs_db != 0

        if csv_total > 0 or tx_in > 0 or db_qty > 0:
            marker = " !" if has_issue else ""
            print(f"{product['name'][:44]:<45} {csv_total:>6} {tx_in:>6} {tx_out:>6} {tx_net:>6} {db_qty:>6} {diff_csv_vs_db:>+6}{marker}")

            if has_issue:
                discrepancies.append({
                    "product": product,
                    "csv_total": csv_total,
                    "csv_sources": csv_expected[pid]["sources"],
                    "tx_in": tx_in,
                    "tx_out": tx_out,
                    "tx_net": tx_net,
                    "db_qty": db_qty,
                    "diff_csv_vs_db": diff_csv_vs_db,
                    "diff_tx_vs_db": diff_tx_vs_db,
                    "tx_detail": tx_summary[pid],
                })

    print()
    print("Legend: CSV=Expected from imports, TX+=Inbound transactions, TX-=Outbound, NET=TX+ minus TX-, DB=Current qty, DIFF=DB minus CSV")

    # =========================================================================
    # STEP 6: Detailed discrepancy analysis
    # =========================================================================
    if discrepancies:
        print()
        print("=" * 70)
        print("SECTION 3: DISCREPANCY DETAILS")
        print("=" * 70)

        for d in discrepancies:
            print()
            print(f"PRODUCT: {d['product']['name']}")
            print(f"  SKU: {d['product']['sku']}")
            print(f"  Current DB Quantity: {d['db_qty']}")
            print()
            print(f"  Expected from CSVs: {d['csv_total']}")
            if d['csv_sources']:
                for source in d['csv_sources']:
                    print(f"    - {source}")
            print()
            print(f"  Transaction History:")
            print(f"    + RESTOCK: {d['tx_detail']['restock']}")
            print(f"    + ADJUSTMENT: {d['tx_detail']['adjustment']}")
            print(f"    + TRANSFER_IN: {d['tx_detail']['transfer_in']}")
            print(f"    - SALE: {d['tx_detail']['sale']}")
            print(f"    - TRANSFER_OUT: {d['tx_detail']['transfer_out']}")
            print(f"    = Net: {d['tx_net']}")
            print()

            if d['diff_csv_vs_db'] < 0:
                print(f"  !  ISSUE: DB has {abs(d['diff_csv_vs_db'])} LESS than CSV expected")
                if d['tx_net'] < d['csv_total']:
                    print(f"      -> Possible cause: Import was not run or partially failed")
            elif d['diff_csv_vs_db'] > 0:
                print(f"  !  ISSUE: DB has {d['diff_csv_vs_db']} MORE than CSV expected")
                if d['tx_net'] > d['csv_total']:
                    print(f"      -> Possible cause: Import was run multiple times")

            if d['diff_tx_vs_db'] != 0:
                print(f"  !  ISSUE: Transaction net ({d['tx_net']}) != DB qty ({d['db_qty']})")
                print(f"      -> Data integrity issue: transactions don't match inventory")

            # Show transaction details
            if d['tx_detail']['restock_txns']:
                print()
                print("  RESTOCK Transactions:")
                for tx in d['tx_detail']['restock_txns']:
                    print(f"    - {tx['created_at'][:10]}: +{tx['quantity']} ({tx['reference_note']})")

            if d['tx_detail']['adjustment_txns']:
                print()
                print("  ADJUSTMENT Transactions:")
                for tx in d['tx_detail']['adjustment_txns']:
                    print(f"    - {tx['created_at'][:10]}: +{tx['quantity']} ({tx['reference_note']})")

    # =========================================================================
    # STEP 7: Summary and recommendations
    # =========================================================================
    print()
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print()
    print(f"Total products in database: {len(products_response.data)}")
    print(f"Products with inventory: {len(current_inventory)}")
    print(f"CSV items that matched: {len(csv_expected)}")
    print(f"CSV items unmatched: {len(csv_unmatched)}")
    print(f"Products with discrepancies: {len(discrepancies)}")

    if csv_unmatched or discrepancies:
        print()
        print("RECOMMENDATIONS:")
        print("-" * 40)

        if csv_unmatched:
            missing_skus = [item['sku'] for item in csv_unmatched if item.get('sku')]
            missing_nosku = [item for item in csv_unmatched if not item.get('sku')]

            if missing_skus:
                print()
                print("1. Add missing products to database:")
                for sku in set(missing_skus):
                    print(f"   - SKU: {sku}")

            if missing_nosku:
                print()
                print("2. Fix CSV rows with missing SKUs:")
                for item in missing_nosku:
                    print(f"   - Row {item['row']}: {item['name']} (qty: {item['quantity']})")

        if discrepancies:
            under_imported = [d for d in discrepancies if d['diff_csv_vs_db'] < 0]
            over_imported = [d for d in discrepancies if d['diff_csv_vs_db'] > 0]

            if under_imported:
                print()
                print("3. Products with LESS stock than expected - may need re-import:")
                for d in under_imported:
                    print(f"   - {d['product']['sku']}: expected {d['csv_total']}, have {d['db_qty']}")

            if over_imported:
                print()
                print("4. Products with MORE stock than expected - may have duplicate imports:")
                for d in over_imported:
                    print(f"   - {d['product']['sku']}: expected {d['csv_total']}, have {d['db_qty']}")
    else:
        print()
        print("No discrepancies found! Inventory matches expected values.")

    print()
    print("=" * 70)
    print("END OF AUDIT REPORT")
    print("=" * 70)


if __name__ == "__main__":
    main()
