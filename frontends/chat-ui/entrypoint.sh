#!/bin/bash
# ============================================================
# chat-ui container entrypoint
#
# 1. Writes /app/public/app_info.json with runtime environment values
#    so custom.js can show the correct version badge and env label in
#    the Help modal without rebuilding the image.
# 2. Creates / verifies Chainlit data-layer tables in PostgreSQL
#    (init_db.py uses asyncpg + CREATE TABLE IF NOT EXISTS — idempotent).
# 3. Execs the Chainlit server.
# ============================================================
set -e

# ---- Write runtime app info for the frontend --------------------------------
mkdir -p /app/public
BUILD_DATE="$(date -u +%Y-%m-%d)"
cat > /app/public/app_info.json << EOF
{
  "version":     "${APP_VERSION:-1.0.0}",
  "environment": "${APP_ENV:-development}",
  "buildDate":   "${BUILD_DATE}"
}
EOF
echo "[entrypoint] app_info.json written (version=${APP_VERSION:-1.0.0}, env=${APP_ENV:-development})"

# ---- Initialise Chainlit DB schema ------------------------------------------
if [ -n "$DATABASE_URL" ]; then
    echo "[entrypoint] Initialising Chainlit DB schema…"
    python3 /app/init_db.py
fi

exec chainlit run chainlit_app.py --host 0.0.0.0 --port 8501
