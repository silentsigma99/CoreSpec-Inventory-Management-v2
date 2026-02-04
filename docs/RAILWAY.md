# Railway Deployment Guide

This guide covers deploying the CoreSpec Inventory System to Railway.

## Prerequisites

- Railway account (https://railway.app)
- GitHub repository connected to Railway
- Supabase project with database set up

## Deployment Steps

### 1. Create a New Railway Project

1. Go to https://railway.app/dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect your GitHub account and select this repository

### 2. Create Backend Service

1. In your Railway project, click "New Service" → "GitHub Repo"
2. Select this repository
3. Click on the service settings (gear icon)
4. Set **Root Directory** to `backend`
5. Add environment variables:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase service role key (`sb_secret_...`) |
| `DATABASE_URL` | Your Supabase database connection string |
| `FRONTEND_URL` | Your frontend Railway URL (set after frontend is deployed) |

6. Deploy - Railway will auto-detect Python and use Nixpacks

### 3. Create Frontend Service

1. Click "New Service" → "GitHub Repo" again
2. Select the same repository
3. Set **Root Directory** to `frontend`
4. Add environment variables:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon/publishable key |
| `NEXT_PUBLIC_API_URL` | Your backend Railway URL (e.g., `https://backend-xxx.railway.app`) |

5. Deploy - Railway will auto-detect Next.js

### 4. Configure Custom Domains (Optional)

1. Click on each service → Settings → Domains
2. Add a custom domain or use Railway's generated domain
3. Update `FRONTEND_URL` in backend with the final frontend domain
4. Update Supabase Auth settings with the frontend domain

### 5. Update Supabase Auth Settings

In your Supabase dashboard:
1. Go to Authentication → URL Configuration
2. Add your Railway frontend URL to "Site URL"
3. Add to "Redirect URLs":
   - `https://your-frontend.railway.app/*`
   - `https://your-frontend.railway.app/auth/callback`

## Environment Variables Reference

### Backend (`backend/`)

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_xxx
DATABASE_URL=postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres
FRONTEND_URL=https://your-frontend.railway.app
```

### Frontend (`frontend/`)

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
```

## Troubleshooting

### Build Fails
- Check Railway build logs for errors
- Ensure all dependencies are in `requirements.txt` (backend) or `package.json` (frontend)

### CORS Errors
- Verify `FRONTEND_URL` in backend matches your actual frontend domain
- Check the backend CORS configuration in `main.py`

### Auth Not Working
- Ensure Supabase redirect URLs include your Railway domain
- Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set correctly

### API Calls Failing
- Verify `NEXT_PUBLIC_API_URL` points to your backend Railway service
- Check backend health at `https://your-backend.railway.app/health`

## Automatic Deployments

Railway automatically deploys when you push to your connected branch (usually `main`). To disable:
1. Go to Service Settings
2. Toggle off "Auto Deploy"
