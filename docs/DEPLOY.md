# AWS Deployment Runbook

First-time deployment guide for `enterprise-ai` on AWS EKS. Subsequent deploys are fully automated via `ci-deploy.yml` once this runbook has been completed.

---

## Prerequisites

Install these tools locally before starting:

```bash
brew install terraform awscli kubectl helm skaffold
# or on Linux: see each tool's official install docs
terraform version   # >= 1.7
aws --version       # >= 2.15
kubectl version --client
helm version        # >= 3.14
```

Configure AWS CLI with an IAM user that has AdministratorAccess (tighten after initial setup):

```bash
aws configure
# AWS Access Key ID: ...
# AWS Secret Access Key: ...
# Default region: us-east-1
# Default output format: json

aws sts get-caller-identity   # Verify — should show your account ID
```

---

## Phase 1 — Bootstrap (run once, ever)

Creates the S3 bucket and DynamoDB table used as the Terraform remote state backend. All subsequent `terraform init` calls depend on these resources existing.

```bash
make tf-bootstrap
```

**Verify:**
```bash
aws s3 ls | grep enterprise-ai-terraform-state
aws dynamodb describe-table \
  --table-name enterprise-ai-terraform-locks \
  --query 'Table.TableStatus'
# Expected: "ACTIVE"
```

---

## Phase 2 — ECR Repositories (run once, ever)

Container registries are global per AWS account. Create them before building any images.

```bash
make tf-ecr
```

**Verify:**
```bash
aws ecr describe-repositories \
  --query 'repositories[*].[repositoryName, repositoryUri]' \
  --output table
# Should list: enterprise-ai/ai-agents, enterprise-ai/data-mcp, etc.

# Smoke test — push a real image to confirm permissions work
ECR_URI=$(cd infra/terraform/ecr && terraform output -raw ai_agents_repository_url | cut -d/ -f1)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin "$ECR_URI"
# Expected: "Login Succeeded"
```

---

## Phase 3 — Secrets Manager (run once per environment)

All secrets live in AWS Secrets Manager. Never put secrets in `.env`, Helm values, or environment variables in GitHub.

```bash
make aws-secrets ENV=dev
# Interactive — prompts for each secret value
```

**What it creates:**
- `enterprise-ai/ai-platform` — `INTERNAL_API_KEY`, `AZURE_API_KEY`, `AZURE_API_BASE`, `DYNATRACE_API_TOKEN`, `REDIS_PASSWORD`
- `enterprise-ai/ai-agents` — `JWT_SECRET`, `CONTEXT_HMAC_SECRET`
- `enterprise-ai/database` — `password`, `username`

**Verify:**
```bash
aws secretsmanager list-secrets \
  --filter Key=name,Values=enterprise-ai \
  --query 'SecretList[*].Name' \
  --output table
# Should list all three secret paths
```

---

## Phase 4 — VPC

Creates the network: 3 AZs, public subnets (for ALB), private subnets (for EKS + RDS + ElastiCache), NAT Gateway, and VPC endpoints for ECR/S3/Secrets Manager.

```bash
make tf-vpc ENV=dev
```

**Takes:** ~3 minutes.

**Verify:**
```bash
VPC_ID=$(cd infra/terraform/vpc && terraform output -raw vpc_id)
aws ec2 describe-vpcs --vpc-ids "$VPC_ID" \
  --query 'Vpcs[0].{State:State, CIDR:CidrBlock}'
# Expected: State=available, CIDR=10.0.0.0/16

aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${VPC_ID}" \
  --query 'Subnets[*].[AvailabilityZone,CidrBlock,Tags[?Key==`Name`].Value|[0]]' \
  --output table
# Should show 3 public (10.0.0-2.0/24) and 3 private (10.0.10-12.0/24) subnets

aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=${VPC_ID}" \
  --query 'NatGateways[*].[NatGatewayId,State]' \
  --output table
# Expected: 1 NAT GW in State=available (dev), 3 for prod
```

---

## Phase 5 — IAM (GitHub OIDC + IRSA Roles — Pass 1)

Creates the GitHub Actions OIDC provider and the deploy role. Run *before* EKS so GitHub CI can push images as soon as ECR exists.

```bash
make tf-iam GITHUB_ORG=your-org GITHUB_REPO=enterprise-ai
```

**Verify:**
```bash
aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn \
  "$(cd infra/terraform/iam && terraform output -raw github_oidc_provider_arn)" \
  --query 'ClientIDList'
# Expected: ["sts.amazonaws.com"]
```

**Add GitHub repository variables** (Settings → Variables → Actions):

| Variable | Value |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCOUNT_ID` | your 12-digit account ID |
| `AWS_DEPLOY_ROLE_ARN` | output of `terraform output -raw github_deploy_role_arn` |
| `EKS_CLUSTER_NAME` | `enterprise-ai-dev` (or prod) |
| `DEPLOY_ENV` | `dev` (or prod) |

**Test OIDC from a GitHub Actions workflow** by pushing any commit to `main` — the deploy workflow will try to assume the role. Check the "Configure AWS credentials" step for success.

---

## Phase 6 — EKS Cluster

Creates the Kubernetes cluster, managed node group, core add-ons (CoreDNS, VPC-CNI, EBS CSI), and the AWS Load Balancer Controller.

```bash
make tf-eks ENV=dev
```

**Takes:** 12–15 minutes (EKS control plane provisioning is slow).

**Verify:**
```bash
# kubectl is auto-configured by the make target, but you can also run:
aws eks update-kubeconfig --name enterprise-ai-dev --region us-east-1

kubectl get nodes
# Expected: 2 nodes in Ready state

kubectl get pods -n kube-system
# Expected: coredns, kube-proxy, aws-node (VPC-CNI), ebs-csi-controller all Running

kubectl get pods -n kube-system | grep aws-load-balancer
# Expected: aws-load-balancer-controller-* Running

kubectl get ingressclass
# Expected: alb   aws  (the ALB IngressClass installed by the LBC)
```

---

## Phase 7 — IAM Pass 2 (IRSA Roles for EKS pods)

Now that EKS exists, re-apply IAM to create the IRSA roles that pods use to call AWS services.

```bash
OIDC_ARN=$(cd infra/terraform/eks && terraform output -raw oidc_provider_arn)
OIDC_URL=$(cd infra/terraform/eks && terraform output -raw oidc_provider_url)

cd infra/terraform/iam
terraform apply \
  -var="github_org=your-org" \
  -var="github_repo=enterprise-ai" \
  -var="eks_oidc_provider_arn=${OIDC_ARN}" \
  -var="eks_oidc_provider_url=${OIDC_URL}"
```

**Verify:**
```bash
terraform output irsa_role_arns
# Expected: external_secrets and litellm_bedrock ARNs (not null)
```

---

## Phase 8 — ElastiCache (Redis)

Creates the Redis cluster in private subnets, replacing the local Docker Redis container.

First, find the Redis password secret ARN created in Phase 3:
```bash
aws secretsmanager describe-secret \
  --secret-id enterprise-ai/ai-platform \
  --query 'ARN'
```

Then apply:
```bash
make tf-elasticache ENV=dev \
  REDIS_SECRET_ARN=arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:enterprise-ai/ai-platform-XXXXX
```

**Verify:**
```bash
REDIS_HOST=$(cd infra/terraform/elasticache && terraform output -raw redis_endpoint)
echo "Redis endpoint: $REDIS_HOST"

# Test connectivity from inside an EKS pod:
kubectl run redis-test --image=redis:7-alpine --rm -it --restart=Never \
  --env="REDISCLI_AUTH=$(aws secretsmanager get-secret-value \
    --secret-id enterprise-ai/ai-platform \
    --query 'SecretString' --output text | jq -r .REDIS_PASSWORD)" \
  -- redis-cli -h "$REDIS_HOST" --tls ping
# Expected: PONG
```

---

## Phase 9 — RDS (PostgreSQL + pgvector)

```bash
DB_SECRET_ARN=$(aws secretsmanager describe-secret \
  --secret-id enterprise-ai/database --query 'ARN' --output text)

make tf-rds ENV=dev DB_SECRET_ARN="$DB_SECRET_ARN"
```

**Verify:**
```bash
RDS_ENDPOINT=$(cd infra/terraform/rds && terraform output -raw db_instance_endpoint 2>/dev/null || \
  aws rds describe-db-instances \
    --db-instance-identifier enterprise-ai-pg-dev \
    --query 'DBInstances[0].Endpoint.Address' --output text)
echo "RDS endpoint: $RDS_ENDPOINT"

# Test from inside an EKS pod:
kubectl run pg-test --image=postgres:16-alpine --rm -it --restart=Never \
  -- psql "postgres://dbadmin@${RDS_ENDPOINT}/ai_memory" -c "SELECT version();"
# Expected: PostgreSQL 16.x
```

---

## Phase 10 — External Secrets Operator

Install ESO and connect it to Secrets Manager so Helm's `secretRef` entries are populated automatically.

```bash
# Get the IRSA role ARN from Phase 7
IRSA_ARN=$(cd infra/terraform/iam && terraform output -raw external_secrets_role_arn)

# Install ESO
IRSA_ROLE_ARN="$IRSA_ARN" bash infra/k8s/secrets/install-eso.sh

# Apply ClusterSecretStore + ExternalSecrets
kubectl create namespace ai-platform --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f infra/k8s/secrets/cluster-secret-store.yaml
kubectl apply -f infra/k8s/secrets/external-secrets.yaml
```

**Verify:**
```bash
kubectl get clustersecretstore aws-secrets-manager \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
# Expected: True

kubectl get externalsecrets -n ai-platform
# Expected: all show READY=True, STATUS=SecretSynced

kubectl get secrets -n ai-platform
# Expected: ai-platform-secrets, ai-agents-secrets, data-mcp-secrets
```

---

## Phase 11 — First Helm Deploy

Update the Helm values with your actual ECR URI (get from `make tf-ecr`):

```bash
ECR_URI=$(cd infra/terraform/ecr && terraform output -raw ai_agents_repository_url | sed 's/\/enterprise-ai\/ai-agents//')
echo "ECR registry: $ECR_URI"
# This value goes in the Helm --set flag at deploy time (CI handles it automatically)
```

For the first manual deploy:
```bash
IMAGE_TAG="sha-$(git rev-parse --short HEAD)"

# Build and push images
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin "$ECR_URI"

docker build -f agents/Dockerfile -t "${ECR_URI}/enterprise-ai/ai-agents:${IMAGE_TAG}" .
docker push "${ECR_URI}/enterprise-ai/ai-agents:${IMAGE_TAG}"

docker build -f tools/data-mcp/Dockerfile -t "${ECR_URI}/enterprise-ai/data-mcp:${IMAGE_TAG}" .
docker push "${ECR_URI}/enterprise-ai/data-mcp:${IMAGE_TAG}"

# Deploy via Helm
helm upgrade --install ai-platform infra/helm/ai-platform \
  --namespace ai-platform --create-namespace \
  --values infra/helm/ai-platform/values.yaml \
  --values infra/helm/ai-platform/values-dev.yaml \
  --wait --atomic

helm upgrade --install data-mcp infra/helm/data-mcp \
  --namespace ai-platform \
  --values infra/helm/data-mcp/values.yaml \
  --set "image.repository=${ECR_URI}/enterprise-ai/data-mcp" \
  --set "image.tag=${IMAGE_TAG}" \
  --wait --atomic

helm upgrade --install ai-agents infra/helm/ai-agents \
  --namespace ai-platform \
  --values infra/helm/ai-agents/values.yaml \
  --values infra/helm/ai-agents/values-dev.yaml \
  --set "image.repository=${ECR_URI}/enterprise-ai/ai-agents" \
  --set "image.tag=${IMAGE_TAG}" \
  --wait --atomic
```

**Verify:**
```bash
make aws-status
# Check all pods Running, ingress has an external DNS address

# Hit the health endpoint
ALB_DNS=$(kubectl get ingress ai-agents -n ai-platform \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl -sf "http://${ALB_DNS}/health"
# Expected: {"status": "ok"} or similar
```

---

## Phase 12 — Enable Automated CI Deploys

Once the first manual deploy succeeds, all future deploys are automated. On every merge to `main`:

1. `ci-unit.yml` runs unit + OPA policy tests
2. `ci-integration.yml` runs integration tests against Docker Compose
3. `ci-deploy.yml` triggers automatically — builds images, pushes to ECR, runs `helm upgrade`, and smoke-tests `/health`

**Verify the full pipeline:**
```bash
git commit --allow-empty -m "chore: trigger CI deploy pipeline"
git push origin main
# Watch: GitHub → Actions → Deploy to EKS workflow
```

---

## Day-2 Operations

**Check cluster status:**
```bash
make aws-status
```

**Roll back a bad deploy:**
```bash
helm rollback ai-agents -n ai-platform      # rolls back to previous revision
helm history ai-agents -n ai-platform        # lists all revisions
```

**Scale pods manually:**
```bash
kubectl scale deployment ai-agents --replicas=4 -n ai-platform
```

**View logs:**
```bash
kubectl logs -n ai-platform -l app=ai-agents --tail=100 -f
kubectl logs -n ai-platform -l app=data-mcp --tail=100 -f
kubectl logs -n ai-platform -l app=opa --tail=50 -f
```

**Rotate a secret:**
```bash
# 1. Update in Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id enterprise-ai/ai-platform \
  --secret-string '{"INTERNAL_API_KEY":"sk-ent-new-value",...}'

# 2. Force ESO to re-sync immediately (instead of waiting up to 1h)
kubectl annotate externalsecret ai-platform-secrets -n ai-platform \
  force-sync=$(date +%s) --overwrite

# 3. Restart pods to pick up the new secret value
kubectl rollout restart deployment/ai-agents -n ai-platform
```

**Upgrade Kubernetes version:**
```bash
# 1. Update cluster_version in eks/variables.tf
# 2. Plan to review the change
cd infra/terraform/eks && terraform plan -var-file="environments/prod.tfvars"
# 3. Apply during a maintenance window
terraform apply -var-file="environments/prod.tfvars"
```
