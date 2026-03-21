#!/usr/bin/env bash
# ============================================================
# Install External Secrets Operator (ESO) into the EKS cluster.
#
# Run this ONCE after EKS is created, before applying external-secrets.yaml.
# Idempotent — safe to run again on upgrades.
#
# Prerequisites:
#   - kubectl configured for the target cluster
#   - helm 3.x installed
#   - IRSA role ARN from: terraform output -raw external_secrets_role_arn
#                         (in infra/terraform/iam/)
#
# Usage:
#   IRSA_ROLE_ARN=arn:aws:iam::123456789:role/enterprise-ai-external-secrets-irsa \
#     ./install-eso.sh
#
# Verification:
#   kubectl get pods -n external-secrets          # all Running
#   kubectl get crds | grep externalsecrets       # CRDs installed
# ============================================================
set -euo pipefail

: "${IRSA_ROLE_ARN:?Set IRSA_ROLE_ARN to the external-secrets IRSA role ARN}"

ESO_VERSION="0.9.16"   # Pin — check https://github.com/external-secrets/external-secrets/releases

echo "→ Adding External Secrets Operator Helm repo..."
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

echo "→ Installing ESO v${ESO_VERSION} in external-secrets namespace..."
helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace \
  --version "${ESO_VERSION}" \
  --set installCRDs=true \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="${IRSA_ROLE_ARN}" \
  --wait

echo "→ Verifying ESO pods..."
kubectl wait --for=condition=Ready pods \
  --selector app.kubernetes.io/name=external-secrets \
  --namespace external-secrets \
  --timeout=120s

echo ""
echo "✅ ESO installed. Next steps:"
echo "   1. Apply ClusterSecretStore:  kubectl apply -f cluster-secret-store.yaml"
echo "   2. Apply ExternalSecrets:     kubectl apply -f external-secrets.yaml"
echo "   3. Verify secrets created:    kubectl get secrets -n ai-platform"
