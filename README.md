# enterprise-ai

Enterprise Agentic AI platform — monorepo. Multi-cloud (Azure + AWS) via LiteLLM, with MCP tools, OPA policy enforcement, and OpenTelemetry observability.

## Repository Structure

```
enterprise-ai/
├── agents/            Agent orchestration service (LangGraph + FastAPI)
├── tools/
│   ├── data-mcp/      MCP server: secure SQL tool for agents
│   └── policies/opa/  Open Policy Agent Rego policies + unit tests
├── platform-sdk/      Shared Python package (LLM client, telemetry, logging)
├── platform/
│   ├── config/        LiteLLM config — local and prod
│   ├── otel/          OTel collector config — local and prod
│   └── db/            Database initialisation SQL
└── infra/
    ├── helm/          Helm charts (ai-platform, data-mcp, ai-agents)
    └── terraform/     AWS RDS (pgvector) provisioning
```

## Quick Start (Local)

### macOS / Linux

```bash
# 1. Install prerequisites (macOS — see Prerequisites table for Linux equivalents)
brew install opa skaffold helm terraform
# Install Docker Desktop from docker.com, Python 3.11+ from python.org

# 2. Install the shared SDK in editable mode
make sdk-install

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in AZURE_API_KEY, AZURE_API_BASE, POSTGRES_PASSWORD,
# and generate INTERNAL_API_KEY with:
#   python -c "import secrets; print('sk-ent-' + secrets.token_hex(24))"

# 4. Start the full stack
make dev-up

# 5. Call the agent
curl -X POST http://localhost:8000/chat \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Run SELECT 1 as check", "session_id": "123e4567-e89b-12d3-a456-426614174000"}'
```

### Windows

Windows development uses **WSL 2 (Windows Subsystem for Linux)** for full parity with CI and production. This gives you a real Linux kernel, native Docker integration, and identical `make` commands to macOS.

**Step 1 — Enable WSL 2 and install Ubuntu**

```powershell
# In PowerShell (run as Administrator)
wsl --install
# Restart your machine when prompted.
# Ubuntu will be installed automatically as the default distribution.
```

**Step 2 — Enable Docker Desktop WSL 2 integration**

Open Docker Desktop → Settings → Resources → WSL Integration → enable your Ubuntu distro → Apply & Restart.

**Step 3 — Access your Windows files from Ubuntu**

Your Windows drives are mounted at `/mnt/c/`, `/mnt/d/`, etc. To work with a repo cloned to `C:\Users\you\work\enterprise-ai`:

```bash
cd /mnt/c/users/you/work/enterprise-ai
```

**Step 4 — Install Linux prerequisites inside Ubuntu**

```bash
# Python (Ubuntu 24.04 requires python3-full for venv support)
sudo apt update && sudo apt install -y python3-full make curl

# OPA CLI
curl -L -o opa https://github.com/open-policy-agent/opa/releases/download/v0.65.0/opa_linux_amd64_static \
  && chmod +x opa && sudo mv opa /usr/local/bin/opa

# Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Skaffold (optional — only needed for Kubernetes workflows)
curl -Lo skaffold https://storage.googleapis.com/skaffold/releases/latest/skaffold-linux-amd64 \
  && chmod +x skaffold && sudo mv skaffold /usr/local/bin/skaffold
```

**Step 5 — Run the quick start**

```bash
# Same steps as macOS/Linux from here
make sdk-install
cp .env.example .env
# Edit .env and fill in credentials:
nano .env
# Generate INTERNAL_API_KEY:
python3 -c "import secrets; print('sk-ent-' + secrets.token_hex(24))"

make dev-up
```

**Calling the agent from PowerShell** (optional — useful for quick ad-hoc tests):

```powershell
# PowerShell 7+ — set your key first
$env:INTERNAL_API_KEY = "sk-ent-your-key-here"

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8000/chat" `
  -Headers @{ Authorization = "Bearer $env:INTERNAL_API_KEY"; "Content-Type" = "application/json" } `
  -Body '{"message": "Run SELECT 1 as check", "session_id": "123e4567-e89b-12d3-a456-426614174000"}'
```

**Windows-specific notes:**
- Line endings: run `git config core.autocrlf false` before cloning — Docker containers require Unix line endings in shell scripts.
- Docker Desktop must be running before `make dev-up`. Pin it to the taskbar so it starts with Windows.
- Port conflicts: Windows services (IIS, SQL Server) may occupy ports 4000, 5432, or 8080. Check with `netstat -ano | findstr :4000` and stop conflicting services.
- If you see `python3: command not found` inside Ubuntu, run `sudo apt install python3-full`.

## Common Commands

| Command | Description |
|---|---|
| `make dev-up` | Start full local stack |
| `make dev-down` | Stop all containers |
| `make dev-logs` | Follow container logs |
| `make test` | Run all tests (Python + OPA) |
| `make lint` | Run ruff linter |
| `make build` | Build Docker images |
| `make k8s-dev` | Deploy to dev Kubernetes cluster |
| `make k8s-prod` | Deploy to production |

## Architecture

```
User → Agent Service (FastAPI)
         ↓  LangGraph ReAct loop
         ↓  calls MCP tools
       Data MCP Server
         ↓  OPA policy check (every call)
         ↓  asyncpg connection pool
       PostgreSQL (pgvector)

All LLM calls → LiteLLM Proxy → Azure OpenAI (local/prod)
                              → AWS Bedrock (prod fallback)

All traces → OTel Collector → Dynatrace
```

## Adding a New MCP Tool

1. Create `tools/<your-tool>/` with `Dockerfile`, `requirements.txt`, `src/server.py`
2. Add the service to `docker-compose.yml` and `skaffold.yaml`
3. Add an OPA allow rule in `tools/policies/opa/tool_auth.rego`
4. Write OPA unit tests in `tools/policies/opa/tool_auth_test.rego`
5. Add a Helm chart in `infra/helm/<your-tool>/`

## Prerequisites

| Tool | Version | macOS | Windows | Linux |
|---|---|---|---|---|
| Docker Desktop | Latest | [docker.com](https://docker.com) | [docker.com](https://docker.com) | [docker.com](https://docker.com) |
| Python | 3.11+ | `brew install python@3.11` | [python.org](https://python.org) installer | `apt install python3.11` |
| Make | Any | pre-installed | `winget install GnuWin32.Make` | `apt install make` |
| OPA CLI | 0.65+ | `brew install opa` | `winget install OpenPolicyAgent.OPA` | `curl -L -o opa https://github.com/open-policy-agent/opa/releases/download/v0.65.0/opa_linux_amd64_static && chmod +x opa && sudo mv opa /usr/local/bin/opa` |
| Skaffold | v2+ | `brew install skaffold` | `winget install GoogleContainerTools.Skaffold` | [skaffold.dev](https://skaffold.dev/docs/install/) |
| Helm | v3+ | `brew install helm` | `winget install Helm.Helm` | `curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \| bash` |
| Terraform | 1.5+ | `brew install terraform` | `winget install Hashicorp.Terraform` | [developer.hashicorp.com](https://developer.hashicorp.com/terraform/install) |
| WSL 2 (Windows only) | Any | — | `wsl --install` in PowerShell (Admin) | — |
