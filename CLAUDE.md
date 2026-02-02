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

### Backend (FastAPI)
```bash
cd backend
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload  # API on localhost:8000
python verify_data.py      # Test Supabase connectivity
```

### Database
Migrations in `database/migrations/` run in order (001-006) against Supabase SQL editor, then `database/seed.sql`.

## Architecture

```
frontend/           # Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui
  src/
    app/            # Pages (login, dashboard routes in (dashboard)/)
    components/     # ui/ (shadcn), layout/ (Header, Sidebar, MobileNav)
    context/        # AuthContext, QueryProvider (TanStack Query)
    lib/            # api.ts (typed client), supabase.ts, utils.ts
    middleware.ts   # Route protection

backend/            # FastAPI + Supabase
  main.py           # App init, CORS, router registration
  app/
    api/            # Route handlers (auth, inventory, warehouses, transfers, sales, transactions)
    core/           # config.py (settings), auth.py (JWT verification)
    models/         # schemas.py (Pydantic models)

database/           # PostgreSQL via Supabase
  migrations/       # Schema + RLS policies
  seed.sql          # Test data
```

## Key Patterns

**Authentication:** Supabase Auth with JWT tokens. Backend verifies via `supabase.auth.get_user(token)` (not manual decode - Supabase uses ES256).

**Access Control:** Role-based (admin sees all warehouses, partner sees assigned only). Enforced by RLS policies in database.

**Data Integrity:** Every stock change creates a transaction record. Atomic transfers create paired TRANSFER_OUT/TRANSFER_IN entries. Inventory quantity >= 0 enforced by CHECK constraint.

**State Management:** TanStack Query for server state. Auth state in React Context.

**UI:** Dark mode default, mobile-first. Tables on desktop, cards on mobile.

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/me` | GET | Current user profile |
| `/api/inventory/{warehouse_id}` | GET | Stock list (supports `page`, `page_size`, `search` params) |
| `/api/warehouses` | GET | All warehouses |
| `/api/transfers` | POST | Transfer stock between warehouses |
| `/api/sales` | POST | Record sale with unit price |
| `/api/transactions/{warehouse_id}` | GET | Transaction history |

## Database Schema

Core tables: `profiles` (extends auth.users), `products` (catalog), `warehouses`, `inventory_items` (warehouse+product stock), `transactions` (audit trail with types: SALE, RESTOCK, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT).

## Critical Troubleshooting

| Problem | Solution |
|---------|----------|
| JWT validation fails | Use `supabase.auth.get_user(token)`, not manual decode |
| `.single()` throws on no rows | Use `.execute()` and check `data[0]` |
| Turbopack cache corrupt | `rm -rf frontend/.next` |
| Backend changes not reloading | Restart: `pkill -f uvicorn` (paths with spaces break file watcher) |
| Port in use | `lsof -i :3000` or `:8000`, then `kill <PID>` |

## Environment Variables

Frontend (`frontend/.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`

Backend (`backend/.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL`, `FRONTEND_URL`

See `docs/TROUBLESHOOTING.md` for detailed debugging guide.
