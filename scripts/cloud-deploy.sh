#!/usr/bin/env bash
# ============================================================
# enterprise-ai — Deploy to Azure VM
#
# Pushes the codebase to the VM, builds Docker images remotely,
# and starts all services. Run from your local desktop:
#
#   ./scripts/cloud-deploy.sh <VM_IP> [SSH_USER]
#
# Or via Make:
#   make cloud-deploy VM_IP=<ip>
# ============================================================
set -euo pipefail

VM_IP="${1:?Usage: cloud-deploy.sh <VM_IP> [SSH_USER]}"
SSH_USER="${2:-azureuser}"
DEPLOY_DIR="/opt/enterprise-ai"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

echo "=== enterprise-ai cloud deployment ==="
echo "    Target: ${SSH_USER}@${VM_IP}"
echo "    Remote: ${DEPLOY_DIR}"
echo ""

# ---- 1. Sync codebase to VM ----
echo "→ Syncing codebase to VM..."
rsync -avz --progress \
  --exclude '.venv' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.pytest_cache' \
  --exclude 'test-results' \
  --exclude '.ruff_cache' \
  --exclude '*.egg-info' \
  --exclude 'dist' \
  --exclude '.env' \
  -e "ssh ${SSH_OPTS}" \
  . "${SSH_USER}@${VM_IP}:${DEPLOY_DIR}/"

# ---- 2. Copy .env if it exists locally ----
if [ -f .env ]; then
  echo "→ Syncing .env file..."
  scp ${SSH_OPTS} .env "${SSH_USER}@${VM_IP}:${DEPLOY_DIR}/.env"
else
  echo "⚠  No local .env found — make sure ${DEPLOY_DIR}/.env exists on the VM"
fi

# ---- 3. Build and start on VM ----
echo "→ Building and starting services on VM..."
ssh ${SSH_OPTS} "${SSH_USER}@${VM_IP}" bash -s <<'REMOTE_SCRIPT'
  set -euo pipefail
  cd /opt/enterprise-ai

  echo "  → Building Docker images..."
  docker compose -f docker-compose.cloud.yml build --parallel

  echo "  → Starting services..."
  docker compose -f docker-compose.cloud.yml up -d

  echo ""
  echo "  → Waiting for services to start..."
  sleep 10

  echo ""
  echo "  → Service status:"
  docker compose -f docker-compose.cloud.yml ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

  echo ""
  echo "  ✅ Deployment complete!"
REMOTE_SCRIPT

echo ""
echo "=== Deployment complete ==="
echo ""
echo "  Analytics Dashboard:  http://${VM_IP}  (via WAF)"
echo "  LangFuse (admin):     http://${VM_IP}:3001"
echo "  SSH:                  ssh ${SSH_USER}@${VM_IP}"
echo ""
echo "  To check logs:        ssh ${SSH_USER}@${VM_IP} 'cd ${DEPLOY_DIR} && docker compose -f docker-compose.cloud.yml logs -f'"
echo "  To seed test data:    ssh ${SSH_USER}@${VM_IP} 'cd ${DEPLOY_DIR} && docker compose -f docker-compose.cloud.yml -f docs/docker-compose.infra-test.yml up -d pgvector'"
