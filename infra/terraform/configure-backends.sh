#!/usr/bin/env bash
# ============================================================
# Patch all backend.tf files with the real S3 bucket name.
#
# Run once after `make tf-bootstrap`. Idempotent — safe to re-run.
#
# Usage:
#   cd infra/terraform/bootstrap && terraform output -raw state_bucket
#   bash ../configure-backends.sh <bucket-name>
#
# Or via Makefile:
#   make tf-bootstrap   (runs this script automatically)
# ============================================================
set -euo pipefail

BUCKET_NAME="${1:-}"

if [[ -z "$BUCKET_NAME" ]]; then
  # Try to read it from bootstrap output automatically
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  BUCKET_NAME=$(cd "$SCRIPT_DIR/bootstrap" && terraform output -raw state_bucket 2>/dev/null || true)
fi

if [[ -z "$BUCKET_NAME" ]]; then
  echo "ERROR: Could not determine bucket name."
  echo "Usage: $0 <bucket-name>"
  echo "  or run from the repo root: make tf-bootstrap"
  exit 1
fi

echo "→ Patching all backend.tf and remote-state references with bucket: ${BUCKET_NAME}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Patch backend.tf files
find "$SCRIPT_DIR" -name "backend.tf" | while read -r f; do
  sed -i.bak "s|bucket *= *\"[^\"]*\"|bucket = \"${BUCKET_NAME}\"|g" "$f"
  rm -f "${f}.bak"
  echo "  ✓ $(realpath --relative-to="$SCRIPT_DIR" "$f")"
done

# 2. Patch tf_state_bucket in all tfvars files
find "$SCRIPT_DIR" -name "*.tfvars" | while read -r f; do
  if grep -q "tf_state_bucket" "$f"; then
    sed -i.bak "s|tf_state_bucket *= *\"[^\"]*\"|tf_state_bucket = \"${BUCKET_NAME}\"|g" "$f"
    rm -f "${f}.bak"
    echo "  ✓ $(realpath --relative-to="$SCRIPT_DIR" "$f")"
  fi
done

echo ""
echo "✅ All backends and tfvars updated to bucket: ${BUCKET_NAME}"
echo "   Run 'terraform init' in each module before applying."
