#!/bin/sh
# Railway 502 fix: Next.js uses process.env.PORT automatically - no -p flag needed.
# #region agent log
echo "[RAILWAY_DEBUG] PORT=${PORT:-unset}"
echo "[RAILWAY_DEBUG] Next.js will use process.env.PORT (no -p flag)"
# #endregion
exec npx next start -H 0.0.0.0
