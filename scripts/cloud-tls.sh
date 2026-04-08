#!/usr/bin/env bash
# ============================================================
# enterprise-ai — Obtain Let's Encrypt TLS certificate on Azure VM
#
# 1. Pushes the nginx config files (resolver + variable proxy_pass)
#    from local to VM via rsync — no inline heredoc fragility.
# 2. SSHes in to run certbot standalone, copy certs into the
#    nginx-certs Docker volume, and restart nginx.
#
# Usage:
#   ./scripts/cloud-tls.sh <VM_IP> [SSH_USER] [DOMAIN]
#
# Or via Make:
#   make cloud-tls VM_IP=<ip> DOMAIN=<domain>
# ============================================================
set -euo pipefail

VM_IP="${1:?Usage: cloud-tls.sh <VM_IP> [SSH_USER] [DOMAIN]}"
SSH_USER="${2:-azureuser}"
DOMAIN="${3:-ai.quantitix.com}"
DEPLOY_DIR="/opt/enterprise-ai"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

echo "=== enterprise-ai TLS setup ==="
echo "    Target: ${SSH_USER}@${VM_IP}"
echo "    Domain: ${DOMAIN}"
echo ""

# ---- 1. Push nginx configs (local → VM) ----------------------
# Pushes nginx.conf, conf.d/analytics.conf, conf.d/langfuse.conf
# so the VM always has the current git version (resolver + $var proxy_pass).
# This avoids fragile inline heredocs that break on CRLF or indentation.
echo "→ Pushing nginx configs to VM..."
rsync -avz \
  -e "ssh ${SSH_OPTS}" \
  ./platform/nginx/ \
  "${SSH_USER}@${VM_IP}:${DEPLOY_DIR}/platform/nginx/"

echo "   ✅ Nginx configs pushed"
echo ""

# ---- 2. Cert + volume + restart (remote) ----------------------
ssh ${SSH_OPTS} "${SSH_USER}@${VM_IP}" bash -s -- "${DOMAIN}" "${DEPLOY_DIR}" << 'REMOTE_SCRIPT'
set -euo pipefail
DOMAIN="$1"
DEPLOY_DIR="$2"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.cloud.yml"

EMAIL="admin@${DOMAIN}"

# -- Stop nginx so port 80 is free for certbot standalone --
echo "→ Stopping nginx to free port 80..."
docker compose -f "${COMPOSE_FILE}" stop nginx 2>/dev/null || true

# -- Install certbot --
echo "→ Installing certbot..."
sudo apt-get update -qq
sudo apt-get install -y certbot

# -- Obtain / verify certificate --
echo "→ Obtaining Let's Encrypt certificate for ${DOMAIN}..."
sudo certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --email "${EMAIL}" \
  --keep-until-expiring \
  -d "${DOMAIN}"

echo "   ✅ Certificate obtained (or already up to date)"

# -- Copy certs into the nginx-certs Docker volume --
echo "→ Locating nginx-certs Docker volume..."
CERT_VOL=$(docker volume inspect enterprise-ai_nginx-certs --format '{{ .Mountpoint }}')
echo "   Volume path: ${CERT_VOL}"

echo "→ Copying certificates to Docker volume..."
sudo mkdir -p "${CERT_VOL}/live/${DOMAIN}"

# Use -L to resolve symlinks so the volume contains real PEM files
sudo cp -L /etc/letsencrypt/live/${DOMAIN}/fullchain.pem "${CERT_VOL}/live/${DOMAIN}/fullchain.pem"
sudo cp -L /etc/letsencrypt/live/${DOMAIN}/privkey.pem   "${CERT_VOL}/live/${DOMAIN}/privkey.pem"
sudo cp -L /etc/letsencrypt/live/${DOMAIN}/chain.pem     "${CERT_VOL}/live/${DOMAIN}/chain.pem"
sudo cp -L /etc/letsencrypt/live/${DOMAIN}/cert.pem      "${CERT_VOL}/live/${DOMAIN}/cert.pem"

sudo chmod 644 "${CERT_VOL}/live/${DOMAIN}/fullchain.pem"
sudo chmod 644 "${CERT_VOL}/live/${DOMAIN}/chain.pem"
sudo chmod 644 "${CERT_VOL}/live/${DOMAIN}/cert.pem"
sudo chmod 640 "${CERT_VOL}/live/${DOMAIN}/privkey.pem"
sudo chown -R root:root "${CERT_VOL}/live/${DOMAIN}"

echo "   ✅ Certificates copied to volume"

# -- Validate nginx config before starting --
echo "→ Validating nginx config..."
docker run --rm \
  -v "${DEPLOY_DIR}/platform/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "${DEPLOY_DIR}/platform/nginx/conf.d:/etc/nginx/conf.d:ro" \
  -v "enterprise-ai_nginx-certs:/etc/letsencrypt:ro" \
  nginx:1.27-alpine nginx -t 2>&1 && echo "   ✅ Nginx config valid" || {
    echo "   ⚠  Nginx config test failed — check conf.d/ on VM"
    docker run --rm \
      -v "${DEPLOY_DIR}/platform/nginx/conf.d:/etc/nginx/conf.d:ro" \
      nginx:1.27-alpine cat /etc/nginx/conf.d/analytics.conf
    exit 1
  }

# -- Start nginx --
echo "→ Starting nginx..."
docker compose -f "${COMPOSE_FILE}" up -d nginx

echo ""
echo "→ Waiting 8s for nginx to initialize..."
sleep 8

echo "→ Service status:"
docker compose -f "${COMPOSE_FILE}" ps nginx --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# -- Verify --
echo ""
echo "→ Testing HTTPS connectivity..."
HTTP_CODE=$(curl -sk --max-time 15 -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" || echo "000")
echo "   Response code: ${HTTP_CODE}"

if echo "${HTTP_CODE}" | grep -qE "^(200|301|302|400|401)"; then
  echo ""
  echo "✅ HTTPS is live at https://${DOMAIN}/"
else
  echo ""
  echo "⚠  Unexpected response code (${HTTP_CODE}). Showing nginx logs:"
  docker logs ai-nginx --tail 30
fi

REMOTE_SCRIPT

echo ""
echo "=== TLS setup complete ==="
echo ""
echo "   Site:  https://${DOMAIN}/"
echo "   SSH:   ssh ${SSH_USER}@${VM_IP}"
echo ""
echo "   To renew certificates (run annually or set up cron):"
echo "     ssh ${SSH_USER}@${VM_IP} 'sudo certbot renew --standalone --pre-hook \"docker stop ai-nginx\" --post-hook \"docker start ai-nginx\"'"
echo ""
