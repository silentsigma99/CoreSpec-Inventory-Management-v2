# Railway Deployment Session Notes
**Date:** 2026-02-04

## Current State

### Files Created/Modified for Railway
- `backend/Procfile` - Start command for FastAPI
- `backend/railway.toml` - Deploy settings (healthcheck)
- `frontend/Procfile` - Start command for Next.js
- `frontend/railway.toml` - Deploy settings (healthcheck)
- `frontend/.env.example` - Environment variable template
- `docs/RAILWAY.md` - Full deployment guide

### Railway URLs
- **Backend:** `https://corespec-inventory-management-v2-production.up.railway.app`
- **Frontend:** `https://artistic-perception-production-d973.up.railway.app`

### Last Issue
Backend build was failing with `pip: command not found` due to custom nixpacks.toml.
**Fix applied:** Removed nixpacks.toml files, switched to Procfile approach.

### Pending Actions
1. **Push latest changes:**
   ```bash
   git add -A && git commit -m "Fix Railway: use Procfile instead of nixpacks.toml" && git push
   ```

2. **Verify environment variables in Railway Dashboard:**

   **Backend service needs:**
   - `SUPABASE_URL` = `https://ftepgplickhbsxmxiiro.supabase.co`
   - `SUPABASE_SERVICE_KEY` = your `sb_secret_...` key
   - `FRONTEND_URL` = `https://artistic-perception-production-d973.up.railway.app`

   **Frontend service needs:**
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://ftepgplickhbsxmxiiro.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon key
   - `NEXT_PUBLIC_API_URL` = `https://corespec-inventory-management-v2-production.up.railway.app`

3. **Update Supabase Auth redirect URLs:**
   - Add `https://artistic-perception-production-d973.up.railway.app/**`
   - Keep `http://localhost:3000/**` for local dev

### Troubleshooting Done
- Tried standalone Next.js output (caused 502) → reverted
- Tried custom nixpacks.toml (pip not found) → switched to Procfile
- Current approach: Let Railway auto-detect with Procfile

### Next Steps When Resuming
1. Push pending changes
2. Wait for Railway to rebuild
3. Test backend: `https://corespec-inventory-management-v2-production.up.railway.app/docs`
4. Test frontend login flow
5. Check CORS if API calls fail
