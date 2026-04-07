# Azure Deployment Guide

This guide covers deploying the enterprise-ai platform to a single Azure Linux VM using Docker Compose. The architecture uses Azure Application Gateway with WAF v2 to protect the analytics dashboard, and NSG rules to restrict LangFuse access to administrators.

## Architecture

```text
Internet
  │
  └─> Azure Application Gateway (WAF v2)  ─── OWASP 3.2 rules
        │
        └─> VM:3003 (Nginx → analytics-dashboard)
              │
              ├─ analytics-agent
              │    ├─ data-mcp       → pgvector
              │    ├─ salesforce-mcp  → pgvector
              │    ├─ payments-mcp   → pgvector
              │    └─ news-search-mcp
              │
              ├─ litellm → Azure OpenAI
              ├─ opa (policy engine)
              ├─ otel-collector → langfuse (OTLP)
              ├─ redis
              └─ pgvector

Admin only (NSG-restricted):
  Admin IP → VM:3001 (Nginx → LangFuse)
  Admin IP → VM:22   (SSH)
```

All services run as Docker containers on a single VM. The Azure Application Gateway provides WAF protection for the public-facing analytics dashboard. LangFuse and SSH are accessible only from whitelisted admin IPs via Azure Network Security Group rules.

## Prerequisites

- Azure CLI (`az`) installed and authenticated
- Terraform >= 1.5
- SSH key pair (`~/.ssh/id_rsa` and `~/.ssh/id_rsa.pub`)
- Docker and rsync on your local machine

## Step 1: Provision Azure Infrastructure

```bash
# Find your public IP (needed for admin access)
curl ifconfig.me

# Copy and edit terraform variables
cd infra/azure
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set admin_ip_cidrs to your IP

# Provision everything
make cloud-infra
```

This creates a Resource Group, VNet with two subnets (VM + App Gateway), NSG with restrictive rules, a Standard_D4s_v5 VM (4 vCPU / 16 GB RAM / 128 GB SSD), and an Application Gateway with WAF v2 using OWASP 3.2 rules in Prevention mode.

The VM is bootstrapped via cloud-init with Docker CE, Docker Compose plugin, fail2ban, and automatic security updates.

Terraform outputs the VM public IP, App Gateway public IP, and the deploy command to use next.

## Step 2: Configure Environment

```bash
# Back in the repo root
cp .env.example .env
# Edit .env with real values:
#   - AZURE_API_KEY, AZURE_API_BASE
#   - INTERNAL_API_KEY (generate with: python -c "import secrets; print('sk-ent-' + secrets.token_hex(24))")
#   - JWT_SECRET, CONTEXT_HMAC_SECRET (generate each)
#   - POSTGRES_PASSWORD, REDIS_PASSWORD
#   - LANGFUSE_DB_PASSWORD, LANGFUSE_NEXTAUTH_SECRET, LANGFUSE_SALT
#   - LANGFUSE_ENCRYPTION_KEY (64 hex chars)
#   - LANGFUSE_CLICKHOUSE_PASSWORD, LANGFUSE_REDIS_PASSWORD
#   - Auth0 variables (see "Auth0 Setup" section below)
```

For production, generate strong unique passwords for every field. Never reuse dev defaults.

## Step 3: Deploy

```bash
# VM_IP from terraform output
make cloud-deploy VM_IP=<vm-ip>
```

This rsyncs the codebase to the VM, copies your `.env`, builds all Docker images on the VM, and starts services with `docker-compose.cloud.yml`. First deploy takes 5-10 minutes (image builds). Subsequent deploys are faster due to Docker layer caching.

## Step 4: Configure LangFuse

LangFuse is accessible only from your admin IP.

1. Open `http://<vm-ip>:3001`
2. Create your admin account and project
3. Go to Settings > API Keys and copy the public + secret keys
4. Update `.env` on the VM:

```bash
ssh azureuser@<vm-ip>
cd /opt/enterprise-ai
nano .env
# Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY
# Generate LANGFUSE_OTEL_AUTH:
#   echo -n "pk-...:sk-..." | base64
docker compose -f docker-compose.cloud.yml restart otel-collector
```

## Step 5: Access the Platform

| Endpoint | URL | Access |
|---|---|---|
| Analytics Dashboard | `http://<appgw-ip>` | Public (WAF-protected) |
| LangFuse | `http://<vm-ip>:3001` | Admin IPs only |
| SSH | `ssh azureuser@<vm-ip>` | Admin IPs only |

## Day-to-Day Operations

```bash
# Check service health
make cloud-status VM_IP=<ip>

# Follow logs
make cloud-logs VM_IP=<ip>

# Redeploy after code changes
make cloud-deploy VM_IP=<ip>

# Stop all services
make cloud-down VM_IP=<ip>
```

### On the VM directly

```bash
ssh azureuser@<vm-ip>
cd /opt/enterprise-ai

# Service status
docker compose -f docker-compose.cloud.yml ps

# Restart a single service
docker compose -f docker-compose.cloud.yml restart analytics-agent

# View logs for specific service
docker compose -f docker-compose.cloud.yml logs -f analytics-agent

# Seed test data (if needed)
docker compose -f docker-compose.cloud.yml \
  -f docs/docker-compose.infra-test.yml up -d pgvector
```

## Auth0 Setup

The analytics dashboard uses Auth0 for user authentication. Users must log in before accessing the dashboard.

### 1. Create Auth0 Application

In the [Auth0 Dashboard](https://manage.auth0.com):

1. Go to **Applications** > **Create Application**
2. Select **Regular Web Application** and name it `enterprise-ai-dashboard`
3. In the **Settings** tab, configure:

| Setting | Local Dev Value | Cloud Value |
|---|---|---|
| Allowed Callback URLs | `http://localhost:3003/auth/callback` | `http://<APPGW_IP>/auth/callback` |
| Allowed Logout URLs | `http://localhost:3003` | `http://<APPGW_IP>` |
| Allowed Web Origins | `http://localhost:3003` | `http://<APPGW_IP>` |

When you add a custom domain later, add its URLs to each field (comma-separated).

4. Copy the **Domain**, **Client ID**, and **Client Secret**

### 2. Configure Environment Variables

Add these to your `.env`:

```bash
AUTH0_SECRET=$(openssl rand -hex 32)
AUTH0_BASE_URL=http://<APPGW_IP>           # or http://localhost:3003 for local dev
AUTH0_DOMAIN=YOUR_TENANT.auth0.com
AUTH0_CLIENT_ID=<from Auth0 settings>
AUTH0_CLIENT_SECRET=<from Auth0 settings>
```

### 3. Configure User Roles

User roles flow from Auth0 through the entire stack to the OPA policy engine for per-user authorization. Three roles are supported: `admin` (full access), `analyst` (standard data analysis), and `viewer` (read-only).

**Option A: Auth0 Post-Login Action (recommended for production)**

In the Auth0 Dashboard, go to **Actions > Flows > Login** and create a custom Action:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  // Map Auth0 roles to application roles.
  // Assign roles via Auth0 Dashboard > User Management > Users > Roles.
  const roles = event.authorization?.roles || [];

  let appRole = "viewer"; // default: least privilege
  if (roles.includes("admin")) appRole = "admin";
  else if (roles.includes("analyst")) appRole = "analyst";

  // Custom claim namespace (must be a URI to avoid collisions)
  api.idToken.setCustomClaim("https://enterprise-ai/role", appRole);
};
```

Then create the roles in **User Management > Roles**: `admin`, `analyst`, `viewer`.
Assign users to roles in **User Management > Users > [user] > Roles**.

**Option B: Default role for all users (local dev / single-user)**

If no Auth0 Action is configured, all users default to `analyst` role, which has full tool access. The OPA policy also allows empty roles in `local`/`dev` environments for backwards compatibility.

### 4. Deploy and Test

```bash
make cloud-deploy VM_IP=<ip>
```

Navigate to `http://<APPGW_IP>` — you should be redirected to the Auth0 login page. After logging in, you'll be returned to the analytics dashboard.

### Local Development

For local development, set `AUTH0_BASE_URL=http://localhost:3003` in your `.env` and make sure `http://localhost:3003/auth/callback` is in the Auth0 Allowed Callback URLs.

## TLS with Let's Encrypt

Once you have a domain pointing to the App Gateway IP:

```bash
make cloud-tls VM_IP=<ip> DOMAIN=analytics.yourdomain.com
```

Then SSH into the VM and uncomment the HTTPS server block in `platform/nginx/conf.d/analytics.conf`, and restart Nginx:

```bash
docker compose -f docker-compose.cloud.yml restart nginx
```

## Updating Admin IP

If your IP changes, update the NSG rules in Terraform:

```bash
cd infra/azure
# Edit terraform.tfvars — update admin_ip_cidrs
terraform apply
```

## CI/CD

The GitHub Actions workflow (`.github/workflows/ci-deploy.yml`) automates deployment after integration tests pass on main. Configure these GitHub settings:

Secrets: `VM_SSH_PRIVATE_KEY` (the private key for SSH access to the VM).

Variables: `VM_IP` (the VM public IP), `VM_SSH_USER` (default: `azureuser`).

## Scaling Beyond a Single VM

When you outgrow a single VM, the natural next step is to separate the database tier (Azure Database for PostgreSQL) and cache tier (Azure Cache for Redis) from the VM, then add a second VM behind the Application Gateway for horizontal scaling. The Docker Compose services are designed to be easily separated — the two-tier local dev architecture (`docker-compose.infra.yml` + `docker-compose.yml`) already models this split.
