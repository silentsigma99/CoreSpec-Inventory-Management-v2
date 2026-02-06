"""
Import an invoiced sale from CSV and optionally record a partial payment.
Run from project root: python scripts/import_invoice_sale.py <csv_file> [options]

Examples:
  python scripts/import_invoice_sale.py "./invoice.csv" --customer "Mr. Areeb" --note "Invoice to Mr. Areeb - 4 Feb 2026"
  python scripts/import_invoice_sale.py "./invoice.csv" --customer "Mr. Areeb" --payment 50000
  python scripts/import_invoice_sale.py "./invoice.csv" --dry-run

This script will:
1. Read the CSV file with invoice items (Product Code, Quantity, Unit Price)
2. Match products by SKU (with normalization)
3. Create an invoice in DRAFT status
4. Confirm the invoice (reserves stock via RPC)
5. Optionally record a partial payment
6. Report results
"""

import argparse
import csv
import os
import sys

from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# Warehouse UUIDs (from seed.sql)
CARPROOFING_WAREHOUSE_ID = "00000000-0000-0000-0000-000000000002"

# SKUs to skip (TBD items)
SKIP_SKUS = {"NAM-TE380B"}


def normalize_sku(sku: str) -> str:
    """Normalize SKU for matching (same logic as import_purchases.py)."""
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


def parse_price(price_str: str) -> float:
    """Parse price string like 'Rs 3,800' or '3800' to float."""
    cleaned = price_str.strip()
    for prefix in ("Rs ", "Rs. ", "RS ", "PKR ", "Rs", "PKR"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    cleaned = cleaned.replace(",", "").strip()
    return float(cleaned)


def lookup_user_id(supabase: Client, email: str) -> str | None:
    """Look up a user's UUID by email using the admin API."""
    try:
        response = supabase.auth.admin.list_users()
        users = response if isinstance(response, list) else getattr(response, "users", [])
        for u in users:
            user_email = u.email if hasattr(u, "email") else u.get("email")
            user_id = u.id if hasattr(u, "id") else u.get("id")
            if user_email == email:
                return user_id
    except Exception as e:
        print(f"WARNING: Could not list users: {e}")
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Import an invoiced sale from CSV."
    )
    parser.add_argument("csv_file", help="Path to CSV file")
    parser.add_argument(
        "--warehouse-id",
        default=CARPROOFING_WAREHOUSE_ID,
        help=f"Warehouse UUID (default: CarProofing {CARPROOFING_WAREHOUSE_ID})",
    )
    parser.add_argument("--customer", default="Mr. Areeb", help="Customer name")
    parser.add_argument("--note", default="Invoice to Mr. Areeb - 4 Feb 2026", help="Invoice note")
    parser.add_argument("--user-email", default="admin@corespec.com", help="Email of user to attribute the sale to")
    parser.add_argument("--payment", type=float, default=50000.0, help="Partial payment amount (0 for no payment)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without creating anything")
    args = parser.parse_args()

    csv_path = args.csv_file
    if not os.path.isabs(csv_path):
        csv_path = os.path.join(os.getcwd(), csv_path)

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment")
        sys.exit(1)

    print("Connecting to Supabase...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Look up user UUID
    print(f"Looking up user: {args.user_email}")
    user_id = lookup_user_id(supabase, args.user_email)
    if not user_id:
        print(f"ERROR: Could not find user with email {args.user_email}")
        sys.exit(1)
    print(f"User ID: {user_id}")

    # Load products
    print("Loading products from database...")
    products_response = supabase.table("products").select("id, sku, name, retail_price").execute()
    products_by_sku: dict[str, dict] = {}
    for p in products_response.data:
        products_by_sku[p["sku"]] = p
        products_by_sku[p["sku"].upper()] = p
        products_by_sku[normalize_sku(p["sku"])] = p
        products_by_sku[normalize_sku(p["sku"]).replace("-", "_")] = p
        products_by_sku[normalize_sku(p["sku"]).replace("-", "")] = p
    print(f"Loaded {len(products_response.data)} products")

    # Normalize skip SKUs
    skip_normalized = {normalize_sku(s) for s in SKIP_SKUS}

    # Read CSV
    if not os.path.exists(csv_path):
        print(f"ERROR: CSV file not found at {csv_path}")
        sys.exit(1)

    print(f"\nReading CSV: {csv_path}")
    items: list[dict] = []
    skipped: list[tuple[str, str, int]] = []
    tbd: list[tuple[str, str, int]] = []

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row_num, row in enumerate(reader, start=2):
            sku = row.get("Product Code", "").strip()
            qty_str = row.get("Quantity", row.get("Qty", "0")).strip()
            unit_price_str = row.get("Unit Price", row.get("Price", "0")).strip()
            description = row.get("Description", row.get("Item Description", "")).strip()

            if not sku:
                continue

            # Skip TBD items
            if normalize_sku(sku) in skip_normalized:
                tbd.append((sku, description, int(qty_str) if qty_str.isdigit() else 0))
                print(f"  TBD (skipped): {sku} - {description}")
                continue

            try:
                quantity = int(qty_str)
            except ValueError:
                print(f"  ERROR Row {row_num}: Invalid quantity '{qty_str}' for {sku}")
                continue

            if quantity <= 0:
                continue

            try:
                unit_price = parse_price(unit_price_str)
            except (ValueError, TypeError):
                print(f"  ERROR Row {row_num}: Invalid price '{unit_price_str}' for {sku}")
                continue

            # Match product
            product = None
            for variation in create_sku_variations(sku):
                if variation in products_by_sku:
                    product = products_by_sku[variation]
                    break

            if not product:
                skipped.append((sku, description, quantity))
                continue

            items.append({
                "product_id": product["id"],
                "product_name": product["name"],
                "sku": sku,
                "quantity": quantity,
                "unit_price": unit_price,
            })
            print(f"  + Matched: {sku} -> {product['name']} x {quantity} @ Rs {unit_price:,.0f}")

    if not items:
        print("\nERROR: No valid items found in CSV")
        sys.exit(1)

    subtotal = sum(item["quantity"] * item["unit_price"] for item in items)
    payment_amount = args.payment

    print(f"\n{'=' * 50}")
    print(f"SUMMARY")
    print(f"{'=' * 50}")
    print(f"Customer: {args.customer}")
    print(f"Warehouse: {args.warehouse_id}")
    print(f"Items: {len(items)}")
    print(f"Total: Rs {subtotal:,.2f}")
    if payment_amount > 0:
        print(f"Payment: Rs {payment_amount:,.2f}")
        print(f"Balance: Rs {max(0, subtotal - payment_amount):,.2f}")
    if tbd:
        print(f"TBD items: {len(tbd)}")
    if skipped:
        print(f"Unmatched: {len(skipped)}")

    if args.dry_run:
        print("\n[DRY RUN] No changes made.")
        if skipped:
            print("\nUNMATCHED PRODUCTS:")
            for sku, desc, qty in skipped:
                print(f"  * {sku}: {desc} (qty: {qty})")
        return

    # Create invoice
    print("\nCreating invoice...")
    invoice_data = {
        "warehouse_id": args.warehouse_id,
        "customer_name": args.customer,
        "notes": args.note,
        "subtotal": subtotal,
        "discount": 0,
        "total": subtotal,
        "status": "DRAFT",
        "created_by": user_id,
    }

    invoice_resp = supabase.table("invoices").insert(invoice_data).execute()
    if not invoice_resp.data or len(invoice_resp.data) == 0:
        print("ERROR: Failed to create invoice")
        sys.exit(1)

    invoice = invoice_resp.data[0]
    invoice_id = invoice["id"]
    print(f"Invoice created: {invoice['invoice_number']} (ID: {invoice_id})")

    # Insert invoice items
    print("Adding invoice items...")
    invoice_items = [
        {
            "invoice_id": invoice_id,
            "product_id": item["product_id"],
            "quantity": item["quantity"],
            "unit_price": item["unit_price"],
            "line_total": item["quantity"] * item["unit_price"],
        }
        for item in items
    ]

    items_resp = supabase.table("invoice_items").insert(invoice_items).execute()
    if not items_resp.data:
        print("ERROR: Failed to insert invoice items")
        supabase.table("invoices").delete().eq("id", invoice_id).execute()
        sys.exit(1)
    print(f"Added {len(invoice_items)} items")

    # Confirm invoice (reserves stock)
    print("\nConfirming invoice (reserving stock)...")
    try:
        confirm_resp = supabase.rpc("confirm_invoice", {
            "p_invoice_id": invoice_id,
            "p_user_id": user_id,
        }).execute()

        if confirm_resp.data is not None:
            print("Invoice confirmed, stock reserved")
        else:
            print("WARNING: confirm_invoice may have failed. Check invoice status.")
    except Exception as e:
        print(f"ERROR: Failed to confirm invoice: {e}")
        print("Invoice remains in DRAFT status. Confirm manually if needed.")
        sys.exit(1)

    # Record partial payment
    if payment_amount > 0:
        print(f"\nRecording payment of Rs {payment_amount:,.2f}...")
        payment_resp = supabase.table("payments").insert({
            "invoice_id": invoice_id,
            "amount": payment_amount,
            "payment_method": "cash",
            "reference_note": f"Initial partial payment - {args.customer}",
            "recorded_by": user_id,
        }).execute()

        if payment_resp.data:
            print("Payment recorded")
        else:
            print("WARNING: Failed to record payment")

        # Update invoice status
        new_balance = subtotal - payment_amount
        new_status = "PAID" if new_balance <= 0 else "PARTIALLY_PAID"

        supabase.table("invoices").update({
            "amount_paid": payment_amount,
            "balance_due": max(0, new_balance),
            "status": new_status,
            **({"paid_at": "now()"} if new_status == "PAID" else {}),
        }).eq("id", invoice_id).execute()

        print(f"Invoice status: {new_status}")

    # Final summary
    balance = max(0, subtotal - payment_amount) if payment_amount > 0 else subtotal
    print(f"\n{'=' * 50}")
    print("IMPORT COMPLETE")
    print(f"{'=' * 50}")
    print(f"Invoice: {invoice['invoice_number']}")
    print(f"Customer: {args.customer}")
    print(f"Items: {len(items)}")
    print(f"Total: Rs {subtotal:,.2f}")
    if payment_amount > 0:
        print(f"Paid: Rs {payment_amount:,.2f}")
        print(f"Balance Due: Rs {balance:,.2f}")

    if tbd:
        print(f"\nTBD ITEMS (excluded, to be added later):")
        for sku, desc, qty in tbd:
            print(f"  * {sku}: {desc} (qty: {qty})")

    if skipped:
        print(f"\nUNMATCHED PRODUCTS (not in database):")
        for sku, desc, qty in skipped:
            print(f"  * {sku}: {desc} (qty: {qty})")
        print("\nTo import these, first add the products to the database,")
        print("then create a new invoice or update this one.")


if __name__ == "__main__":
    main()
