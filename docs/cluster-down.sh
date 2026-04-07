#!/bin/bash
# ============================================================
# cluster-down.sh  — Park the dev environment (stop EC2 costs)
#
# What this does:
#   1. Scales the EKS node group to 0 (stops all EC2 charges)
#   2. Leaves the EKS control plane running (~$0.10/hr, ~$73/mo)
#   3. Leaves RDS running — stop it too if you want full savings
#
# All Helm releases, secrets, and configs are preserved in K8s
# etcd. Pods reschedule automatically when nodes come back.
#
# Usage:  bash cluster-down.sh [--include-rds]
# ============================================================

set -e
CLUSTER="enterprise-ai-dev"
REGION="us-east-1"
INCLUDE_RDS=false
[[ "$1" == "--include-rds" ]] && INCLUDE_RDS=true

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }

# ── Find the managed node group ────────────────────────────
info "Looking up node group..."
NODEGROUP=$(aws eks list-nodegroups --cluster-name "$CLUSTER" --region "$REGION" \
  --query 'nodegroups[0]' --output text)

if [[ -z "$NODEGROUP" || "$NODEGROUP" == "None" ]]; then
  echo "ERROR: No node group found for cluster $CLUSTER"
  exit 1
fi
info "Node group: $NODEGROUP"

# ── Scale nodes to 0 ───────────────────────────────────────
info "Scaling node group to 0..."
aws eks update-nodegroup-config \
  --cluster-name "$CLUSTER" \
  --nodegroup-name "$NODEGROUP" \
  --scaling-config minSize=0,maxSize=6,desiredSize=0 \
  --region "$REGION"

info "Node scale-down initiated. EC2 instances will terminate in ~2-3 minutes."

# ── Optionally stop RDS ────────────────────────────────────
if $INCLUDE_RDS; then
  info "Stopping RDS instance..."
  DB_ID=$(aws rds describe-db-instances --region "$REGION" \
    --query 'DBInstances[0].DBInstanceIdentifier' --output text)
  aws rds stop-db-instance --db-instance-identifier "$DB_ID" --region "$REGION"
  info "RDS stop initiated: $DB_ID (takes ~2 min)"
else
  warn "RDS is still running. Use --include-rds to stop it too."
  warn "RDS cost: ~\$0.02-0.05/hr while stopped is not possible (RDS auto-starts after 7 days)"
fi

echo ""
info "✅ Cluster parked. Estimated savings: ~\$0.50-2.00/hr (EC2 instances stopped)"
info "   EKS control plane still costs ~\$0.10/hr"
info "   To restart:  bash cluster-up.sh"
