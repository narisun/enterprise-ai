#!/bin/bash
# ============================================================
# deploy-new-services.sh
# Deploys all 6 new services to EKS in the correct order:
#   1. Rebuild agent-ui with VITE_API_KEY baked in (build-time Vite var)
#   2. MCP servers  (salesforce-mcp, payments-mcp, news-search-mcp)
#   3. Agents       (rm-prep-agent, portfolio-watch-agent)
#   4. Frontend     (agent-ui)
# Run from the monorepo root: bash deploy-new-services.sh
# ============================================================

set -e

ECR_REGISTRY="393035998869.dkr.ecr.us-east-1.amazonaws.com"
TAG="v20260321140652"
# agent-ui must be rebuilt with VITE_API_KEY baked in, so it gets its own tag
UI_TAG="v$(date +%Y%m%d%H%M%S)-ui"
NAMESPACE="ai-platform"
REGION="us-east-1"

# ── Load INTERNAL_API_KEY from .env ───────────────────────────────────────
# This key is the Bearer token the browser sends to the backend agents.
# It must be baked into the React bundle at Docker build time (Vite replaces
# import.meta.env.VITE_API_KEY with a literal string at compile time).
if [[ -f .env ]]; then
  INTERNAL_API_KEY=$(grep '^INTERNAL_API_KEY=' .env | cut -d= -f2- | tr -d '"'"'" )
fi
if [[ -z "$INTERNAL_API_KEY" ]]; then
  echo "ERROR: INTERNAL_API_KEY not found in .env — cannot build agent-ui"
  exit 1
fi

# Colour helpers
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
section() { echo -e "\n${GREEN}======================================${NC}"; echo -e "${GREEN}  $*${NC}"; echo -e "${GREEN}======================================${NC}"; }

# ── Resolve RDS endpoint ───────────────────────────────────────────────────
section "Resolving RDS endpoint"
RDS_ENDPOINT=$(aws rds describe-db-instances \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text --region "$REGION")

if [[ -z "$RDS_ENDPOINT" || "$RDS_ENDPOINT" == "None" ]]; then
  echo -e "${RED}ERROR: Could not resolve RDS endpoint. Check AWS credentials.${NC}"
  exit 1
fi
info "RDS endpoint: $RDS_ENDPOINT"

# ── ECR login ──────────────────────────────────────────────────────────────
section "ECR login"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"
info "ECR login successful"

# ── STEP 0: Rebuild agent-ui with VITE_API_KEY baked in ──────────────────
# The React bundle is generated at Docker build time. Vite replaces
# import.meta.env.VITE_API_KEY with the literal key value. If it is
# empty the frontend throws in production mode and the app fails to load.
section "Step 0 — Rebuilding agent-ui with VITE_API_KEY"
info "New agent-ui tag: ${UI_TAG}"
# --no-cache ensures Docker does not reuse a cached 'npm run build' layer
# from a previous build where VITE_API_KEY was empty. Vite bakes the value
# into the bundle at compile time, so a cache hit would silently produce a
# broken bundle with an empty key.
docker build \
  --no-cache \
  -f frontends/agent-ui/Dockerfile \
  --build-arg VITE_API_KEY="${INTERNAL_API_KEY}" \
  -t "${ECR_REGISTRY}/enterprise-ai/agent-ui:${UI_TAG}" \
  frontends/agent-ui/

info "Pushing agent-ui image..."
docker push "${ECR_REGISTRY}/enterprise-ai/agent-ui:${UI_TAG}"
info "agent-ui image pushed ✓"

# ── Helper: install or upgrade a Helm release ────────────────────────────
deploy_or_upgrade() {
  local CHART_NAME=$1
  local CHART_PATH=$2
  local VALUES_FILE=$3
  shift 3
  local EXTRA_ARGS=("$@")

  if helm status "$CHART_NAME" -n "$NAMESPACE" &>/dev/null; then
    info "Upgrading $CHART_NAME..."
    helm upgrade "$CHART_NAME" "$CHART_PATH" \
      -n "$NAMESPACE" \
      -f "$VALUES_FILE" \
      "${EXTRA_ARGS[@]}"
  else
    info "Installing $CHART_NAME..."
    helm install "$CHART_NAME" "$CHART_PATH" \
      -n "$NAMESPACE" \
      -f "$VALUES_FILE" \
      "${EXTRA_ARGS[@]}"
  fi
}

# ── STEP 1: Deploy MCP servers ─────────────────────────────────────────────
section "Step 1 — Deploying MCP servers"

deploy_or_upgrade salesforce-mcp ./infra/helm/salesforce-mcp \
  infra/helm/salesforce-mcp/values-dev.yaml \
  --set image.repository="${ECR_REGISTRY}/enterprise-ai/salesforce-mcp" \
  --set image.tag="${TAG}" \
  --set env.DB_HOST="${RDS_ENDPOINT}"

deploy_or_upgrade payments-mcp ./infra/helm/payments-mcp \
  infra/helm/payments-mcp/values-dev.yaml \
  --set image.repository="${ECR_REGISTRY}/enterprise-ai/payments-mcp" \
  --set image.tag="${TAG}" \
  --set env.DB_HOST="${RDS_ENDPOINT}"

deploy_or_upgrade news-search-mcp ./infra/helm/news-search-mcp \
  infra/helm/news-search-mcp/values-dev.yaml \
  --set image.repository="${ECR_REGISTRY}/enterprise-ai/news-search-mcp" \
  --set image.tag="${TAG}"

# ── Wait for MCP servers ───────────────────────────────────────────────────
section "Waiting for MCP servers to become Ready (timeout 3 min each)"
for SVC in salesforce-mcp payments-mcp news-search-mcp; do
  info "Waiting for $SVC..."
  kubectl rollout status deployment/"$SVC" -n "$NAMESPACE" --timeout=180s
  info "$SVC is Ready ✓"
done

# ── STEP 2: Deploy agents ──────────────────────────────────────────────────
section "Step 2 — Deploying agents"

deploy_or_upgrade rm-prep-agent ./infra/helm/rm-prep-agent \
  infra/helm/rm-prep-agent/values-dev.yaml \
  --set image.repository="${ECR_REGISTRY}/enterprise-ai/rm-prep-agent" \
  --set image.tag="${TAG}"

deploy_or_upgrade portfolio-watch-agent ./infra/helm/portfolio-watch-agent \
  infra/helm/portfolio-watch-agent/values-dev.yaml \
  --set image.repository="${ECR_REGISTRY}/enterprise-ai/portfolio-watch-agent" \
  --set image.tag="${TAG}"

# ── Wait for agents ────────────────────────────────────────────────────────
section "Waiting for agents to become Ready (timeout 3 min each)"
for SVC in rm-prep-agent portfolio-watch-agent; do
  info "Waiting for $SVC..."
  kubectl rollout status deployment/"$SVC" -n "$NAMESPACE" --timeout=180s
  info "$SVC is Ready ✓"
done

# ── STEP 3: Deploy agent-ui ────────────────────────────────────────────────
section "Step 3 — Deploying agent-ui (creates public ALB)"

deploy_or_upgrade agent-ui ./infra/helm/agent-ui \
  infra/helm/agent-ui/values-dev.yaml \
  --set image.repository="${ECR_REGISTRY}/enterprise-ai/agent-ui" \
  --set image.tag="${UI_TAG}"

kubectl rollout status deployment/agent-ui -n "$NAMESPACE" --timeout=180s
info "agent-ui is Ready ✓"

# ── Get ALB URL ────────────────────────────────────────────────────────────
section "Fetching ALB URL"
echo "Waiting 30s for ALB hostname to be assigned..."
sleep 30

ALB_URL=$(kubectl get ingress agent-ui -n "$NAMESPACE" \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")

if [[ -n "$ALB_URL" ]]; then
  info "✅ Agent UI is live at: http://${ALB_URL}"
  echo ""
  echo "  Open in browser: http://${ALB_URL}"
  echo ""
  warn "DNS propagation may take 1-2 minutes. If the page doesn't load, wait and retry."
else
  warn "ALB hostname not yet assigned. Run this to check:"
  echo "  kubectl get ingress agent-ui -n ai-platform"
  echo "  kubectl describe ingress agent-ui -n ai-platform"
fi

# ── Final status ───────────────────────────────────────────────────────────
section "Deployment complete — Pod status"
kubectl get pods -n "$NAMESPACE" -o wide
echo ""
info "Helm releases:"
helm list -n "$NAMESPACE"
