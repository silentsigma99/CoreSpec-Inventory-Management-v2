# CoreSpec Inventory System - Troubleshooting & Learnings

This document captures key learnings from debugging authentication and API issues during development. Reference this when encountering similar problems.

---

## 1. Supabase JWT Authentication

### Problem: JWT Signature Verification Failed
**Error:** `JWSError: The specified alg value is not allowed`

**Root Cause:**  
Supabase has migrated to using **ES256 (ECDSA)** algorithm for JWTs instead of the older **HS256 (HMAC)**. The JWT header shows:
```json
{"alg": "ES256", "kid": "7b052b22-ae56-4..."}
```

**What Didn't Work:**
1. Using `python-jose` with HS256 algorithm and JWT secret
2. Fetching JWKS from `https://<project>.supabase.co/auth/v1/jwks` - returns 401 Unauthorized

**Solution:**  
Use Supabase's built-in token verification instead of manual JWT decoding:

```python
# ❌ DON'T DO THIS - Manual JWT verification
from jose import jwt
payload = jwt.decode(token, secret, algorithms=["HS256"])

# ✅ DO THIS - Use Supabase's built-in verification
from supabase import create_client
supabase = create_client(url, service_key)
user_response = supabase.auth.get_user(token)
user = user_response.user
```

**Why This Works:**  
- Supabase client handles algorithm detection automatically
- Uses service role key which has permission to verify tokens
- Works regardless of which signing algorithm Supabase uses

---

## 2. Supabase Query Patterns

### Problem: `.single()` Throws Error When No Record Exists
**Error:** `APIError: No rows returned` or similar

**Root Cause:**  
The `.single()` method expects exactly one row and throws an error if zero rows are returned.

**What Didn't Work:**
```python
# ❌ This throws an error if no record exists
result = supabase.table("inventory_items")\
    .select("*")\
    .eq("warehouse_id", warehouse_id)\
    .eq("product_id", product_id)\
    .single()\
    .execute()

if result.data:  # Never reaches here - error already thrown
    ...
```

**Solution:**  
Remove `.single()` and check the data array:

```python
# ✅ This safely handles zero results
result = supabase.table("inventory_items")\
    .select("*")\
    .eq("warehouse_id", warehouse_id)\
    .eq("product_id", product_id)\
    .execute()

# Check if any results exist
record = result.data[0] if result.data else None

if record:
    # Update existing
    quantity = record["quantity_on_hand"]
else:
    # Create new
    ...
```

**When to Use `.single()`:**
- Only when you're certain a record exists (e.g., fetching by primary key after validation)
- When absence of a record should be an error

---

## 3. Next.js Turbopack Cache Corruption

### Problem: Frontend Crashes with Database/SST File Errors
**Error:**
```
Failed to restore task data (corrupted database or bug)
Unable to open static sorted file 00000080.sst
No such file or directory (os error 2)
```

**Root Cause:**  
Turbopack's development cache can become corrupted, especially:
- After crashes or force-kills
- With paths containing spaces (iCloud paths)
- After major code changes

**Solution:**
```bash
# Stop the dev server
pkill -f "next dev"

# Delete the .next cache folder
rm -rf frontend/.next

# Restart
cd frontend && npm run dev
```

**Prevention:**
- Gracefully stop dev servers when possible (Ctrl+C)
- Add `.next` to `.gitignore` (already done)

---

## 4. File Watcher Issues with Spaces in Paths

### Problem: Backend Auto-Reload Not Working
**Symptom:** Changes to Python files don't trigger uvicorn reload

**Root Cause:**  
File paths with spaces (common in iCloud/macOS paths) can cause issues with file watchers like WatchFiles.

**Solution:**  
Manually restart the backend after changes:
```bash
pkill -f "uvicorn main:app"
cd backend && source venv/bin/activate && uvicorn main:app --reload
```

**Alternative:** Move project to a path without spaces for better dev experience.

---

## 5. Port Conflicts

### Problem: "Address already in use" or "Port X is in use"

**Solution:**
```bash
# Find and kill process on port 3000 (frontend)
lsof -i :3000
kill <PID>

# Find and kill process on port 8000 (backend)
lsof -i :8000
kill <PID>

# Or kill by process name
pkill -f "next dev"
pkill -f "uvicorn main:app"
```

---

## 6. CORS Issues

### Problem: Frontend can't reach backend API
**Error:** `CORS policy: No 'Access-Control-Allow-Origin' header`

**Checklist:**
1. Backend CORS middleware is configured:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

2. Frontend is using the correct API URL in `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

3. Backend is actually running on the expected port

---

## 7. Environment Variables

### Common Issues:
1. **Missing `.env` file** - Copy from `.env.example`
2. **Spaces around `=`** - Don't use spaces: `KEY=value` not `KEY = value`
3. **Quotes around values** - Usually not needed, can cause issues
4. **Changes not picked up** - Restart the server after `.env` changes

### Required Variables:

**Frontend (`frontend/.env.local`):**
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Backend (`backend/.env`):**
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
DATABASE_URL=postgresql://...
FRONTEND_URL=http://localhost:3000
```

---

## Quick Debugging Commands

```bash
# Check if backend is running
curl http://localhost:8000/health

# Check if frontend is running
curl http://localhost:3000

# View backend logs (find correct terminal file)
ls -la ~/.cursor/projects/*/terminals/

# Test API endpoint directly
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/me

# Check Supabase connection
curl https://<project>.supabase.co/rest/v1/ -H "apikey: <anon_key>"
```

---

## Summary of Key Learnings

| Issue | Wrong Approach | Correct Approach |
|-------|---------------|------------------|
| JWT Verification | Manual decode with HS256 | `supabase.auth.get_user(token)` |
| Optional DB Records | `.single()` then check | `.execute()` then check `data[0]` |
| Cache Corruption | Keep trying | Delete `.next` folder |
| Auto-reload fails | Wait for reload | Manual restart |
| 500 errors | Guess the cause | Check backend terminal logs |

---

*Last Updated: January 2026*
