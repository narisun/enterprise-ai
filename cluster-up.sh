#!/bin/bash
# ============================================================
# cluster-up.sh  — Resume the dev environment
#
# What this does:
#   1. Starts RDS if it was stopped
#   2. Scales the EKS node group back to desired capacity
#   3. Waits for nodes to be Ready
#   4. Restarts pods that need fresh SSE connections
#      (rm-prep-agent connects to MCP servers at startup;
#       if it starts before MCPs are ready it needs a nudge)
#   5. Shows all pod status and the agent-ui URL
#
# Usage:  bash cluster-up.sh
# ============================================================

set -e
CLUSTER="enterprise-ai-dev"
REGION="us-east-1"
NAMESPACE="ai-platform"
DESIRED_NODES=2   # adjust to your normal node count

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
section() { echo -e "\n${GREEN}======================================${NC}"; echo -e "${GREEN}  $*${NC}"; echo -e "${GREEN}======================================${NC}"; }

# ── Start RDS if stopped ───────────────────────────────────
section "Checking RDS"
DB_ID=$(aws rds describe-db-instances --region "$REGION" \
  --query 'DBInstances[0].DBInstanceIdentifier' --output text)
DB_STATUS=$(aws rds describe-db-instances --region "$REGION" \
  --query 'DBInstances[0].DBInstanceStatus' --output text)

info "RDS $DB_ID status: $DB_STATUS"
if [[ "$DB_STATUS" == "stopped" ]]; then
  info "Starting RDS..."
  aws rds start-db-instance --db-instance-identifier "$DB_ID" --region "$REGION"
  info "Waiting for RDS to be available (this takes ~3-5 minutes)..."
  aws rds wait db-instance-available --db-instance-identifier "$DB_ID" --region "$REGION"
  info "RDS is available ✓"
elif [[ "$DB_STATUS" == "starting" ]]; then
  info "RDS is already starting, waiting..."
  aws rds wait db-instance-available --db-instance-identifier "$DB_ID" --region "$REGION"
  info "RDS is available ✓"
else
  info "RDS is already running ✓"
fi

# ── Scale up node group ────────────────────────────────────
section "Scaling up EKS node group"
NODEGROUP=$(aws eks list-nodegroups --cluster-name "$CLUSTER" --region "$REGION" \
  --query 'nodegroups[0]' --output text)
info "Node group: $NODEGROUP"

CURRENT=$(aws eks describe-nodegroup \
  --cluster-name "$CLUSTER" --nodegroup-name "$NODEGROUP" --region "$REGION" \
  --query 'nodegroup.scalingConfig.desiredSize' --output text)

if [[ "$CURRENT" -ge "$DESIRED_NODES" ]]; then
  info "Node group already at $CURRENT nodes ✓"
else
  info "Scaling from $CURRENT → $DESIRED_NODES nodes..."
  aws eks update-nodegroup-config \
    --cluster-name "$CLUSTER" \
    --nodegroup-name "$NODEGROUP" \
    --scaling-config minSize=1,maxSize=6,desiredSize="$DESIRED_NODES" \
    --region "$REGION"
fi

# ── Wait for nodes to be Ready ─────────────────────────────
section "Waiting for nodes to be Ready"
echo "This takes 3-5 minutes while EC2 instances boot and join the cluster..."
until kubectl get nodes 2>/dev/null | grep -q " Ready"; do
  echo "$(date +%H:%M:%S): Waiting for nodes..."
  sleep 15
done
info "Nodes are Ready ✓"
kubectl get nodes

# ── Wait for core pods to reschedule ──────────────────────
section "Waiting for pods to reschedule"
echo "Waiting 60s for Kubernetes to reschedule all pods..."
sleep 60

# ── Restart MCP-dependent agents in the right order ───────
# rm-prep-agent connects to 3 MCP servers via SSE at startup.
# If it starts before the MCPs are ready, the connection fails.
# We restart MCPs first, wait, then restart the agent.
section "Restarting services in dependency order"

info "Step 1 — Restarting MCP servers..."
kubectl rollout restart deployment/salesforce-mcp  -n "$NAMESPACE"
kubectl rollout restart deployment/payments-mcp    -n "$NAMESPACE"
kubectl rollout restart deployment/news-search-mcp -n "$NAMESPACE"
kubectl rollout restart deployment/data-mcp        -n "$NAMESPACE"

info "Waiting for MCP servers to be Ready..."
for SVC in salesforce-mcp payments-mcp news-search-mcp data-mcp; do
  kubectl rollout status deployment/"$SVC" -n "$NAMESPACE" --timeout=120s
  info "$SVC Ready ✓"
done

info "Step 2 — Restarting agents (after MCPs are up)..."
kubectl rollout restart deployment/rm-prep-agent       -n "$NAMESPACE"
kubectl rollout restart deployment/portfolio-watch-agent -n "$NAMESPACE"
kubectl rollout restart deployment/ai-agents           -n "$NAMESPACE"

for SVC in rm-prep-agent portfolio-watch-agent ai-agents; do
  kubectl rollout status deployment/"$SVC" -n "$NAMESPACE" --timeout=120s
  info "$SVC Ready ✓"
done

info "Step 3 — Restarting UI and LiteLLM..."
kubectl rollout restart deployment/agent-ui     -n "$NAMESPACE"
kubectl rollout restart deployment/litellm-proxy -n "$NAMESPACE"
for SVC in agent-ui litellm-proxy; do
  kubectl rollout status deployment/"$SVC" -n "$NAMESPACE" --timeout=120s
  info "$SVC Ready ✓"
done

# ── Final status ───────────────────────────────────────────
section "All services up — Status"
kubectl get pods -n "$NAMESPACE"

echo ""
ALB_URL=$(kubectl get ingress agent-ui -n "$NAMESPACE" \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
if [[ -n "$ALB_URL" ]]; then
  info "✅ Agent UI: http://${ALB_URL}"
else
  warn "Run: kubectl get ingress agent-ui -n ai-platform"
fi
