#!/bin/sh
# ----------------------------------------------------------------
# LangFuse project seeder
#
# Verifies that the LANGFUSE_INIT_* headless initialization worked
# by testing the API keys against the LangFuse API. If they fail,
# logs clear instructions for the user.
#
# Also serves as a fallback: if LANGFUSE_INIT_* didn't work (e.g.
# older image), creates an account and project via the REST API,
# then outputs the generated keys for the user to put in .env.
#
# Required env vars:
#   LANGFUSE_URL          — internal URL (default: http://langfuse:3000)
#   EXPECTED_PUBLIC_KEY   — public key from .env to verify
#   EXPECTED_SECRET_KEY   — secret key from .env to verify
#   SEED_EMAIL            — admin email
#   SEED_PASSWORD         — admin password
# ----------------------------------------------------------------
set -e

URL="${LANGFUSE_URL:-http://langfuse:3000}"
PK="${EXPECTED_PUBLIC_KEY:-}"
SK="${EXPECTED_SECRET_KEY:-}"
EMAIL="${SEED_EMAIL:-admin@local.dev}"
PASSWORD="${SEED_PASSWORD:-admin}"

echo "[langfuse-seed] Waiting for LangFuse at $URL ..."
for i in $(seq 1 90); do
  if wget -qO /dev/null "$URL/api/public/health" 2>/dev/null; then
    echo "[langfuse-seed] LangFuse is healthy."
    break
  fi
  [ "$i" = "90" ] && echo "[langfuse-seed] TIMEOUT" && exit 1
  sleep 2
done
sleep 3

# ── Test if LANGFUSE_INIT_* worked ──────────────────────────────
if [ -n "$PK" ] && [ -n "$SK" ]; then
  echo "[langfuse-seed] Testing if .env keys work (LANGFUSE_INIT_* check) ..."
  # The /api/public/ingestion endpoint returns 207 with valid keys,
  # 401 with invalid keys.
  TEST_RESP=$(wget -qO /dev/null -S \
    --header="Authorization: Basic $(echo -n "$PK:$SK" | base64)" \
    --post-data '{"batch":[]}' \
    --header="Content-Type: application/json" \
    "$URL/api/public/ingestion" 2>&1 || true)

  if echo "$TEST_RESP" | grep -q "207\|200"; then
    echo "[langfuse-seed] SUCCESS: .env keys are valid. LANGFUSE_INIT_* worked."
    echo "[langfuse-seed] Traces will be received correctly."
    exit 0
  fi
  echo "[langfuse-seed] .env keys rejected — LANGFUSE_INIT_* did not provision them."
  echo "[langfuse-seed] Falling back to REST API provisioning ..."
fi

# ── Fallback: create account + project via REST API ─────────────
echo "[langfuse-seed] Creating admin account ($EMAIL) ..."
wget -qO /dev/null --post-data "{\"name\":\"Admin\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  --header="Content-Type: application/json" \
  "$URL/api/auth/signup" 2>/dev/null || true

# Authenticate
CSRF_PAGE=$(wget -qO- "$URL/api/auth/csrf" 2>/dev/null || echo '{}')
CSRF_TOKEN=$(echo "$CSRF_PAGE" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')

if [ -z "$CSRF_TOKEN" ]; then
  echo "[langfuse-seed] ERROR: Cannot get CSRF token."
  exit 1
fi

COOKIE_JAR=$(mktemp)
wget -qO /dev/null --save-cookies "$COOKIE_JAR" --keep-session-cookies \
  --post-data "csrfToken=$CSRF_TOKEN&email=$EMAIL&password=$PASSWORD&json=true&callbackUrl=$URL" \
  --header="Content-Type: application/x-www-form-urlencoded" \
  "$URL/api/auth/callback/credentials?callbackUrl=$URL" 2>/dev/null || true

# Verify session
SESSION=$(wget -qO- --load-cookies "$COOKIE_JAR" "$URL/api/auth/session" 2>/dev/null || echo '{}')
if ! echo "$SESSION" | grep -q '"email"'; then
  echo "[langfuse-seed] ERROR: Cannot authenticate."
  rm -f "$COOKIE_JAR"
  exit 1
fi

# Get default project (signup auto-creates one)
PROJECTS=$(wget -qO- --load-cookies "$COOKIE_JAR" "$URL/api/projects" 2>/dev/null || echo '[]')
PROJECT_ID=$(echo "$PROJECTS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$PROJECT_ID" ]; then
  echo "[langfuse-seed] Creating project ..."
  CREATE_RESP=$(wget -qO- --load-cookies "$COOKIE_JAR" \
    --post-data '{"name":"Enterprise AI"}' \
    --header="Content-Type: application/json" \
    "$URL/api/projects" 2>/dev/null || echo '{}')
  PROJECT_ID=$(echo "$CREATE_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

# Create API key pair
KEYS=$(wget -qO- --load-cookies "$COOKIE_JAR" \
  --post-data '{"note":"dev-auto-generated"}' \
  --header="Content-Type: application/json" \
  "$URL/api/projects/$PROJECT_ID/apiKeys" 2>/dev/null || echo '{}')
rm -f "$COOKIE_JAR"

NEW_PK=$(echo "$KEYS" | grep -o '"publicKey":"[^"]*"' | head -1 | cut -d'"' -f4)
NEW_SK=$(echo "$KEYS" | grep -o '"secretKey":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$NEW_PK" ] && [ -n "$NEW_SK" ]; then
  echo ""
  echo "================================================================"
  echo "  LangFuse generated NEW API keys."
  echo "  Update your .env file with:"
  echo ""
  echo "  LANGFUSE_PUBLIC_KEY=$NEW_PK"
  echo "  LANGFUSE_SECRET_KEY=$NEW_SK"
  echo ""
  echo "  Then restart: docker compose restart"
  echo "================================================================"
  echo ""

  # Write to shared volume for automated pickup
  mkdir -p /keys 2>/dev/null || true
  cat > /keys/langfuse-keys.env <<EOF
LANGFUSE_PUBLIC_KEY=$NEW_PK
LANGFUSE_SECRET_KEY=$NEW_SK
EOF
else
  echo "[langfuse-seed] WARNING: Could not generate API keys."
  echo "[langfuse-seed] Create them manually at $URL (Settings > API Keys)."
fi

echo "[langfuse-seed] Done."
