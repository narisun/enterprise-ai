#!/usr/bin/env bash
# ============================================================
# Create AWS Secrets Manager entries for enterprise-ai.
#
# Run once per environment before the first deploy.
# Safe to re-run — uses put-secret-value to update existing secrets.
#
# Usage: ./create-secrets.sh dev | ./create-secrets.sh prod
#        OR: make aws-secrets ENV=dev
#
# After running, verify in AWS Console:
#   AWS Console → Secrets Manager → Filter "enterprise-ai/"
# ============================================================
set -euo pipefail

ENV="${1:-dev}"
REGION="${AWS_REGION:-us-east-1}"

echo "Creating Secrets Manager entries for ENV=${ENV} in ${REGION}..."
echo ""

prompt_secret() {
  local secret_path="$1"
  local description="$2"
  shift 2
  declare -A kv

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Secret: ${secret_path}"
  echo "Usage:  ${description}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local json="{"
  local first=true
  for key in "$@"; do
    read -rsp "  ${key}: " value
    echo ""
    if [[ "$first" == "true" ]]; then
      json+="\"${key}\": \"${value}\""
      first=false
    else
      json+=", \"${key}\": \"${value}\""
    fi
  done
  json+="}"

  # Create or update the secret
  if aws secretsmanager describe-secret \
    --secret-id "${secret_path}" \
    --region "${REGION}" >/dev/null 2>&1; then
    echo "  → Updating existing secret..."
    aws secretsmanager put-secret-value \
      --secret-id "${secret_path}" \
      --secret-string "${json}" \
      --region "${REGION}" \
      --output text --query 'ARN'
  else
    echo "  → Creating new secret..."
    aws secretsmanager create-secret \
      --name "${secret_path}" \
      --description "${description}" \
      --secret-string "${json}" \
      --region "${REGION}" \
      --output text --query 'ARN'
  fi
  echo ""
}

# ---- Platform secrets (shared across services) ----
prompt_secret \
  "enterprise-ai/ai-platform" \
  "Shared platform credentials: LiteLLM master key, Azure OpenAI, Dynatrace, Redis" \
  "INTERNAL_API_KEY" "AZURE_API_KEY" "AZURE_API_BASE" "DYNATRACE_API_TOKEN" "REDIS_PASSWORD"

# ---- Agent secrets ----
prompt_secret \
  "enterprise-ai/ai-agents" \
  "Agent service secrets: JWT signing + context HMAC" \
  "JWT_SECRET" "CONTEXT_HMAC_SECRET"

# ---- Database credentials ----
# Note: DB master password is managed separately via infra/terraform/rds/
# This entry is for the app-level DB password used by data-mcp.
prompt_secret \
  "enterprise-ai/database" \
  "PostgreSQL credentials for application services" \
  "password" "username"

echo "✅ All secrets created."
echo ""
echo "Next steps:"
echo "  1. Install ESO:         IRSA_ROLE_ARN=<arn> bash infra/k8s/secrets/install-eso.sh"
echo "  2. Apply secret store:  kubectl apply -f infra/k8s/secrets/cluster-secret-store.yaml"
echo "  3. Apply ext secrets:   kubectl apply -f infra/k8s/secrets/external-secrets.yaml"
echo "  4. Verify:              kubectl get externalsecrets -A"
