# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CoreSpec Inventory System (CIS) - Multi-warehouse inventory management for CoreSpec Distribution (car detailing products). Tracks stock across warehouses, records transfers, logs sales with full audit trail.

## Commands

### Frontend (Next.js)
```bash
cd frontend
npm run dev      # Dev server on localhost:3000
npm run build    # Production build
npm run lint     # ESLint
```

### CLI Scripts (Python)
```bash
# Install dependencies (one-time)
pip install -r scripts/requirements.txt

# Create scripts/.env with SUPABASE_URL and SUPABASE_SERVICE_KEY

# Run scripts from project root
python scripts/verify_data.py                    # Test Supabase connectivity
python scripts/audit_inventory.py                # Audit database inventory
python scripts/import_purchases.py "./file.csv"  # Import purchases from CSV
python scripts/reconcile_inventory.py "./file.csv" "Note"  # Add inventory adjustments
```

### Database
Migrations in `database/migrations/` run in order (001-006) against Supabase SQL editor, then `database/seed.sql`.

## Architecture

```
frontend/           # Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui
  src/
    app/
      api/          # API routes (all backend logic lives here)
        me/         # GET - current user profile
        brands/     # GET - list of brands
        warehouses/ # GET - list warehouses, GET [id] - single warehouse
        inventory/  # GET - all inventory, GET [id] - warehouse inventory
        sales/      # POST - record sale
        purchases/  # POST - record purchase
        transfers/  # POST - transfer stock
        transactions/  # GET [id] - transaction history
      (dashboard)/  # Protected dashboard pages
      login/        # Login page
    components/     # ui/ (shadcn), layout/ (Header, Sidebar, MobileNav)
    context/        # AuthContext, QueryProvider (TanStack Query)
    lib/
      api.ts        # Typed API client (uses relative paths)
      supabase.ts   # Browser Supabase client
      supabase-server.ts  # Server Supabase client + auth utilities
    middleware.ts   # Route protection

scripts/            # Python CLI tools (admin scripts)
  audit_inventory.py
  reconcile_inventory.py
  import_purchases.py
  verify_data.py
  requirements.txt

database/           # PostgreSQL via Supabase
  migrations/       # Schema + RLS policies
  seed.sql          # Test data
```

## Key Patterns

**Authentication:** Supabase Auth with session cookies. API routes verify via `supabase.auth.getUser()` from cookies (same-origin, no manual token handling needed).

**Access Control:** Role-based (admin sees all warehouses, partner sees assigned only). Enforced by RLS policies in database + API route checks.

**Data Integrity:** Every stock change creates a transaction record. Atomic transfers create paired TRANSFER_OUT/TRANSFER_IN entries. Inventory quantity >= 0 enforced by CHECK constraint.

**State Management:** TanStack Query for server state. Auth state in React Context.

**UI:** Dark mode default, mobile-first. Tables on desktop, cards on mobile.

## API Endpoints

All API routes are in `frontend/src/app/api/`. Same-origin requests - cookies sent automatically.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/me` | GET | Current user profile |
| `/api/brands` | GET | List of product brands |
| `/api/warehouses` | GET | All warehouses (role-filtered) |
| `/api/warehouses/{id}` | GET | Single warehouse |
| `/api/inventory` | GET | All inventory (role-filtered) |
| `/api/inventory/{warehouse_id}` | GET | Warehouse inventory (pagination, search, brand filter) |
| `/api/sales` | POST | Record sale with unit price |
| `/api/purchases` | POST | Record purchase (admin only) |
| `/api/transfers` | POST | Transfer stock between warehouses (admin only) |
| `/api/transactions/{warehouse_id}` | GET | Transaction history (pagination, filters) |

## Database Schema

Core tables: `profiles` (extends auth.users), `products` (catalog), `warehouses`, `inventory_items` (warehouse+product stock), `transactions` (audit trail with types: SALE, RESTOCK, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT).

## Critical Troubleshooting

| Problem | Solution |
|---------|----------|
| Auth fails in API route | Check `supabase-server.ts` is using correct env vars |
| `.single()` throws on no rows | Use `.execute()` and check `data[0]` |
| Blank page after login | Profile missing in DB - API auto-creates if missing |
| Wrong Supabase key type | Server needs `SUPABASE_SERVICE_KEY` (sb_secret_...) |
| Turbopack cache corrupt | `rm -rf frontend/.next` |
| Port in use | `lsof -i :3000`, then `kill <PID>` |

## Environment Variables

**Frontend (`frontend/.env.local`):**
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_KEY=sb_secret_...  # Server-side only, not exposed to browser
```

**CLI Scripts (`scripts/.env`):**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_...
```

**Supabase API Keys (New Format as of Nov 2025):**
| Old (Legacy) | New | Use |
|--------------|-----|-----|
| `anon` key (eyJ...) | `sb_publishable_...` | Frontend/browser |
| `service_role` key (eyJ...) | `sb_secret_...` | Server-side only (bypasses RLS) |

- Never expose `sb_secret_...` keys in frontend code
- Secret keys cannot be used in browsers (blocked by User-Agent check)
- Create/manage keys in Supabase Dashboard -> Project Settings -> API

See `docs/TROUBLESHOOTING.md` for detailed debugging guide.

## Deployment (Railway)

Single Railway service - API routes are built into Next.js.

1. Create new project on Railway
2. Connect GitHub repo
3. Set root directory to `frontend`
4. Railway auto-detects Next.js via `railway.toml` and `nixpacks.toml`
5. Add environment variables in Railway dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY` (for API routes)
6. Deploy - Railway will run `npm run build` then `npm start`

**Config Files:**
- `railway.toml` - Railway deployment config
- `nixpacks.toml` - Build process config (Node.js 20)
