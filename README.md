# CoreSpec Inventory System (CIS)

Inventory management application for CoreSpec Distribution - a car detailing product distributor. Tracks inventory across multiple warehouses/partners, records transfers between locations, and logs sales.

## Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Python FastAPI
- **Database:** PostgreSQL (Supabase)
- **Authentication:** Supabase Auth

## Project Structure

```
├── frontend/          # Next.js 14 application
├── backend/           # FastAPI application
├── database/          # SQL migrations and seed data
│   └── migrations/
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- Supabase account (for database and auth)

### Frontend Setup

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local with your Supabase credentials
npm install
npm run dev
```

Frontend runs at <http://localhost:3000>

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your Supabase credentials
uvicorn main:app --reload
```

Backend runs at <http://localhost:8000>

### Database Setup

1. Create a Supabase project at <https://supabase.com>
2. Run the migrations in `database/migrations/` against your Supabase database
3. Run `database/seed.sql` to populate test data

## Environment Variables

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `NEXT_PUBLIC_API_URL` | Backend API URL (default: <http://localhost:8000>) |

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase service role key |
| `SUPABASE_JWT_SECRET` | Your Supabase JWT secret |
| `DATABASE_URL` | Direct PostgreSQL connection string |
| `FRONTEND_URL` | Frontend URL for CORS (default: <http://localhost:3000>) |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/me` | GET | Get current user profile |
| `/api/inventory/{warehouse_id}` | GET | Get inventory for a warehouse |
| `/api/warehouses` | GET | List warehouses |
| `/api/transfers` | POST | Transfer stock between warehouses |
| `/api/sales` | POST | Record a sale |
| `/api/transactions/{warehouse_id}` | GET | Get transaction history |

## Features

- **Role-based access:** Admins see all warehouses, partners see only their assigned location
- **Stock transfers:** Atomic transactions ensure data integrity
- **Sales recording:** Decrement stock and log audit trail
- **Transaction history:** Full audit trail of all stock movements
- **Mobile-first UI:** Optimized for use on phones while managing inventory

## Documentation

- **[Troubleshooting Guide](docs/TROUBLESHOOTING.md)** - Common issues and solutions for JWT auth, Supabase queries, cache corruption, and more

## Troubleshooting Quick Reference

| Problem | Solution |
|---------|----------|
| JWT validation fails | Use `supabase.auth.get_user(token)` instead of manual decode |
| Frontend stuck loading | Clear cache: `rm -rf frontend/.next` |
| Backend changes not reflecting | Restart manually: `pkill -f uvicorn` |
| Port already in use | Kill process: `lsof -i :3000` then `kill <PID>` |
| 500 Internal Server Error | Check backend terminal for detailed error logs |

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for detailed explanations.
