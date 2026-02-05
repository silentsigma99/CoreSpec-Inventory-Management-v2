# Railway 502 Error Analysis

## Issue Summary

The Railway deployment consistently returns 502 Bad Gateway errors despite the Next.js server starting successfully and healthchecks passing.

## Timeline of Changes Made

### 1. Initial Diagnosis - Next.js 16 Middleware Deprecation

**Observation:** Build logs showed:
```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
```

**Action:** Downgraded from Next.js 16.1.5 to 15.5.12
- Updated `next` package
- Updated `eslint-config-next` to match
- Updated `eslint.config.mjs` for Next.js 15 compatibility

**Result:** Build succeeded, no middleware warnings, but 502 persisted.

### 2. Standalone Build Investigation

**Observation:** Suspected standalone build output was corrupted due to:
```
⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
We detected multiple lockfiles and selected the directory of /Users/hammadarain/package-lock.json
```

**Action:** Switched from standalone mode to regular `next start`:
- Removed `output: "standalone"` from `next.config.ts`
- Updated `railway.toml` and `nixpacks.toml` to use `npm start`

**Result:** 502 persisted.

### 3. Port Mismatch Discovery

**Observation:** Deploy logs showed server running correctly:
```
▲ Next.js 15.5.12
- Local:        http://localhost:8080
- Network:      http://0.0.0.0:8080
✓ Ready in 625ms
```

Healthcheck also passed:
```
[1/1] Healthcheck succeeded!
```

**Root Cause Identified:** User discovered the Railway domain's custom port was set to **3000** while the server was listening on **8080**.

**Action:** User manually changed domain port to 8080.

**Result:** Site worked temporarily.

### 4. Port Reset on Redeploy

**Observation:** After pushing documentation updates, Railway redeployed and the 502 returned. The domain port appeared to reset.

**Action Attempts:**
1. Hardcoded port 3000 in `railway.toml` and `nixpacks.toml`
2. Hardcoded port 3000 in `package.json` start script
3. Changed to port 8080 in `package.json` to match Railway's auto-detected port

**Result:** 502 still persists.

---

## Key Technical Findings

### Railway's Port Behavior

1. **Railway sets `PORT=8080`** as an environment variable
2. **Railway auto-detects** the port and sets the domain routing accordingly
3. **Domain port configuration** may reset or be auto-managed by Railway
4. **Nixpacks** may ignore `railway.toml` and `nixpacks.toml` start commands, preferring to auto-detect from `package.json`

### The Port Configuration Chain

```
package.json "start" script
        ↓
Nixpacks detects and may modify
        ↓
railway.toml startCommand (may be ignored)
        ↓
Railway's PORT env var injection
        ↓
Server listens on final port
        ↓
Railway domain routes to configured port
```

### What We Know Works

- **Build succeeds** - All routes compile, no errors
- **Server starts** - Logs show "Ready in Xms"
- **Healthcheck passes** - Railway reports `[1/1] Healthcheck succeeded!`
- **Internal networking works** - Healthcheck can reach the server

### What's Failing

- **External requests** - Browser/curl requests return 502
- **Port routing** - Mismatch between server port and domain port

---

## Current Configuration State

### package.json
```json
"start": "next start -H 0.0.0.0 -p 8080"
```

### railway.toml
```toml
[deploy]
startCommand = "npm start"
healthcheckPath = "/"
```

### nixpacks.toml
```toml
[start]
cmd = "npm start"
```

---

## Hypotheses for Continued 502

### Hypothesis 1: Railway Caching
Railway may be caching old build/deploy configurations. The Nixpacks output still shows old start commands despite pushes.

**Test:** Manually trigger a fresh deploy with "Clear build cache" option if available.

### Hypothesis 2: Domain Configuration Lag
The domain port configuration may not update immediately or may be managed separately from deployments.

**Test:** Check Railway dashboard → Service → Settings → Networking → Verify domain port matches 8080.

### Hypothesis 3: Multiple Replicas/Deployments
There may be multiple deployments or replicas, and traffic is routed to an old/dead one.

**Test:** Check Deployments tab, ensure only one active deployment, remove any stale ones.

### Hypothesis 4: Railway Internal Routing Issue
Railway's proxy/load balancer may have stale routing rules.

**Test:** Delete the service and recreate it from scratch.

### Hypothesis 5: Environment Variable Conflict
Railway's `PORT` env var (8080) conflicts with our hardcoded port.

**Test:** Remove hardcoded port, use `${PORT:-3000}` and manually set domain to 8080.

---

## Recommended Next Steps

1. **Check Railway Dashboard:**
   - Settings → Networking → Verify domain port is 8080
   - Deployments → Ensure latest deployment is active
   - Metrics → Check if container is running or crashing

2. **Clear Railway Cache:**
   - If option exists, clear build cache and redeploy

3. **Try Using Railway's PORT Variable:**
   ```json
   "start": "next start -H 0.0.0.0 -p ${PORT:-8080}"
   ```
   This defers to Railway's PORT while having a fallback.

4. **Check for Service-Level Issues:**
   - Contact Railway support if issue persists
   - Check Railway status page for outages

5. **Nuclear Option:**
   - Delete Railway service
   - Create new service from scratch
   - This resets all cached configurations

---

## Latest Change (Attempt 6): Direct `next start` with `$PORT`

### Reasoning

Previous attempts used `npm start` which reads from `package.json`. The problem:

1. **package.json cannot expand environment variables** - Writing `"start": "next start -p $PORT"` in package.json does NOT work because JSON doesn't support shell variable expansion
2. **Hardcoding ports creates mismatches** - Hardcoding 3000 or 8080 assumes Railway's behavior, which may vary
3. **Nixpacks may override our commands** - Build logs showed Nixpacks using its own detected start command, ignoring our configs

### The Fix

Changed `railway.toml` and `nixpacks.toml` to run `next start` directly (not via npm):

```toml
# railway.toml
startCommand = "next start -H 0.0.0.0 -p $PORT"

# nixpacks.toml
cmd = "next start -H 0.0.0.0 -p $PORT"
```

And reverted `package.json` to simple:
```json
"start": "next start"
```

### Why This Should Work

1. **Shell variable expansion** - `$PORT` expands in the shell context of railway.toml/nixpacks.toml
2. **Bypasses npm** - Running `next start` directly avoids any npm/package.json complexity
3. **Uses Railway's PORT** - Railway sets `PORT=8080`, so server listens on 8080
4. **Domain auto-matches** - Railway auto-detects port 8080 and configures domain routing

### If This Fails

The issue is likely Railway-specific infrastructure:
- Stale deployments
- Cached routing rules
- Service-level configuration issues

**Nuclear option:** Delete the Railway service entirely and recreate from scratch.

---

## Resolution (Feb 2026)

**Log evidence confirmed:**
- `PORT=8080` — Railway injects correctly
- `Network: http://0.0.0.0:8080` — App binds correctly
- `Ready in 606ms` — Server starts successfully

**Root cause:** Domain target port mismatch. The app listens on 8080, but Railway's domain may route to a different port (e.g. 3000).

**Fix:** Railway Dashboard → Service → Settings → Public Networking → Click the **edit icon** next to your domain → Set **target port to 8080**.

**Code change:** Switched to `sh scripts/start-railway.sh` which runs `npx next start -H 0.0.0.0` (no `-p` flag). Next.js uses `process.env.PORT` automatically.

---

## Lessons Learned

1. **Next.js 16 has breaking changes** - Middleware file convention is deprecated
2. **Railway's port detection is complex** - Multiple layers (env var, domain config, auto-detection)
3. **Config file hierarchy unclear** - `railway.toml`, `nixpacks.toml`, and `package.json` may conflict
4. **Healthcheck success ≠ external access** - Internal health can pass while external routing fails
5. **Document deployment issues** - Port mismatches are subtle and hard to diagnose from logs alone
6. **package.json doesn't expand env vars** - Shell variables like `$PORT` don't work in JSON
7. **Use direct commands over npm wrappers** - Running `next start` directly is more predictable than `npm start`
