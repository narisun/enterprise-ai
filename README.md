# enterprise-ai

Enterprise Agentic AI platform — monorepo. Multi-cloud (Azure + AWS) via LiteLLM, with MCP tools, OPA policy enforcement, Redis caching, context compaction, and OpenTelemetry observability. All cross-cutting concerns (security, caching, compaction, observability) live in the shared `platform-sdk` so every new agent or MCP server inherits them automatically.

## Repository Structure

```
enterprise-ai/
├── agents/                  Agent orchestration service (LangGraph + FastAPI)
│   ├── src/
│   │   ├── server.py        FastAPI server — auth, /chat endpoint
│   │   ├── graph.py         LangGraph ReAct agent builder (uses platform-sdk)
│   │   ├── mcp_bridge.py    MCP SSE client + LangChain tool adapter
│   │   └── prompts/         Jinja2 system prompt templates
│   ├── Dockerfile
│   └── requirements.txt
│
├── tools/
│   ├── data-mcp/            MCP server: secure read-only SQL tool
│   │   ├── src/server.py    FastMCP server (uses platform-sdk)
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   ├── chat-ui/             Chainlit web chat UI with history
│   │   ├── chainlit_app.py  Chainlit app (uses platform-sdk)
│   │   ├── init_db.py       PostgreSQL schema init/migration
│   │   └── Dockerfile
│   └── policies/opa/        Open Policy Agent Rego policies + unit tests
│
├── platform-sdk/            Shared Python package — installed into every service
│   └── platform_sdk/
│       ├── __init__.py      Public API (all exports in one place)
│       ├── config.py        AgentConfig, MCPConfig — typed env-var config
│       ├── security.py      OpaClient, make_api_key_verifier
│       ├── cache.py         ToolResultCache, cached_tool decorator
│       ├── compaction.py    make_compaction_modifier — context window trimming
│       ├── agent.py         build_agent — LangGraph ReAct agent factory
│       ├── llm_client.py    EnterpriseLLMClient — LiteLLM wrapper
│       ├── telemetry.py     setup_telemetry — OpenTelemetry init (idempotent)
│       └── logging.py       configure_logging, get_logger — structlog JSON
│
├── platform/
│   ├── config/              LiteLLM YAML configs — local and prod
│   ├── otel/                OTel Collector config — local and prod
│   └── db/                  Database initialisation SQL
│
└── infra/
    ├── helm/                Helm charts (ai-platform, data-mcp, ai-agents)
    └── terraform/           AWS RDS (pgvector) provisioning
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

# 5. Open the Chat UI
open http://localhost:8501
# Login: any username / INTERNAL_API_KEY as password

# 6. Or call the agent REST API directly
curl -X POST http://localhost:8000/chat \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Run SELECT 1 as check", "session_id": "123e4567-e89b-12d3-a456-426614174000"}'
```

### Windows

Windows development uses **WSL 2 (Windows Subsystem for Linux)** for full parity with CI and production.

**Step 1 — Enable WSL 2 and install Ubuntu**

```powershell
# In PowerShell (run as Administrator)
wsl --install
# Restart your machine when prompted.
```

**Step 2 — Enable Docker Desktop WSL 2 integration**

Open Docker Desktop → Settings → Resources → WSL Integration → enable your Ubuntu distro → Apply & Restart.

**Step 3 — Install Linux prerequisites inside Ubuntu**

```bash
sudo apt update && sudo apt install -y python3-full make curl

# OPA CLI
curl -L -o opa https://github.com/open-policy-agent/opa/releases/download/v0.65.0/opa_linux_amd64_static \
  && chmod +x opa && sudo mv opa /usr/local/bin/opa

# Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

**Step 4 — Run the quick start**

```bash
cd /mnt/c/users/you/work/enterprise-ai
make sdk-install
cp .env.example .env
nano .env   # fill in credentials
make dev-up
```

**Windows-specific notes:**
- Run `git config core.autocrlf false` before cloning — Docker requires Unix line endings.
- Docker Desktop must be running before `make dev-up`.
- Port conflicts: `netstat -ano | findstr :4000` to check for IIS/SQL Server conflicts.

## Common Commands

| Command | Description |
|---|---|
| `make dev-up` | Start full local stack |
| `make dev-down` | Stop all containers |
| `make dev-logs` | Follow container logs |
| `make test` | Run all tests (Python + OPA) |
| `make lint` | Run ruff linter |
| `make sdk-install` | Install platform-sdk locally in editable mode |
| `make build` | Build Docker images |
| `make k8s-dev` | Deploy to dev Kubernetes cluster |
| `make k8s-prod` | Deploy to production |

## Architecture

```
                    ┌──────────────────────────────┐
                    │  Chat UI (Chainlit)  :8501    │
                    │  tools/chat-ui/               │
                    └──────────────┬───────────────┘
                                   │ or
         curl / REST client        │
                    ┌──────────────▼───────────────┐
                    │  Agent Service  :8000         │
                    │  agents/src/server.py         │
                    │  · Bearer auth (SDK)          │
                    │  · AgentConfig.from_env()     │
                    │  · build_agent() from SDK     │
                    └──────┬───────────────┬────────┘
                           │ LLM calls     │ MCP tool calls (SSE)
                           ▼               ▼
            ┌──────────────────┐  ┌────────────────────────┐
            │  LiteLLM  :4000  │  │  Data MCP Server :8080 │
            │  Azure OpenAI    │  │  tools/data-mcp/       │
            │  AWS Bedrock     │  │  · OpaClient (SDK)     │
            │  Redis cache     │  │  · ToolResultCache(SDK)│
            └──────────────────┘  └───────────┬────────────┘
                                              │
              ┌──────────────────────────────┬┴──────────────────────┐
              ▼                              ▼                        ▼
   ┌──────────────────┐         ┌──────────────────┐      ┌──────────────────┐
   │  PostgreSQL :5432│         │  OPA Engine :8181│      │  Redis  (cache)  │
   │  · Agent memory  │         │  · Rego policies │      │  · LiteLLM cache │
   │  · Workspace data│         │  · tool_auth.rego│      │  · Tool results  │
   │  · Chat history  │         └──────────────────┘      └──────────────────┘
   └──────────────────┘
                    All traces → OTel Collector → Dynatrace
```

## The Platform SDK

All cross-cutting concerns are in `platform-sdk/platform_sdk/`. Services import what they need — there is no boilerplate to copy.

| Module | What it provides | Used by |
|---|---|---|
| `config` | `AgentConfig`, `MCPConfig` — typed dataclasses with `from_env()` | All services |
| `security` | `OpaClient`, `make_api_key_verifier()` | Agent service, MCP servers |
| `cache` | `ToolResultCache`, `@cached_tool` | MCP servers |
| `compaction` | `make_compaction_modifier()` | Agent service (via `agent.py`) |
| `agent` | `build_agent()` — ReAct agent factory | Agent service, Chat UI |
| `logging` | `configure_logging()`, `get_logger()` | All services |
| `telemetry` | `setup_telemetry()` | All services |
| `llm_client` | `EnterpriseLLMClient` | Standalone LLM usage |

See [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for step-by-step guides to building new agents and MCP servers using the SDK.

## Adding a New MCP Tool Server

```bash
# 1. Scaffold from the existing example
cp -r tools/data-mcp tools/my-tool
# 2. Implement your tool in tools/my-tool/src/server.py (see DEVELOPER_GUIDE.md)
# 3. Add the service to docker-compose.yml
# 4. Add an OPA allow rule in tools/policies/opa/tool_auth.rego
# 5. Write OPA unit tests in tools/policies/opa/tool_auth_test.rego
# 6. Add a Helm chart in infra/helm/my-tool/
```

## Adding a New Agent Service

```bash
# 1. Create agents-myagent/ with Dockerfile, requirements.txt, src/
# 2. Use platform_sdk.build_agent() — all wiring is automatic (see DEVELOPER_GUIDE.md)
# 3. Add the service to docker-compose.yml
# 4. Add a Helm chart in infra/helm/my-agent/
```

## Prerequisites

| Tool | Version | macOS | Windows (WSL) | Linux |
|---|---|---|---|---|
| Docker Desktop | Latest | [docker.com](https://docker.com) | [docker.com](https://docker.com) | [docker.com](https://docker.com) |
| Python | 3.11+ | `brew install python@3.11` | `apt install python3-full` | `apt install python3.11` |
| Make | Any | pre-installed | `apt install make` | `apt install make` |
| OPA CLI | 0.65+ | `brew install opa` | see Quick Start | see Quick Start |
| Skaffold | v2+ | `brew install skaffold` | [skaffold.dev](https://skaffold.dev/docs/install/) | [skaffold.dev](https://skaffold.dev/docs/install/) |
| Helm | v3+ | `brew install helm` | see Quick Start | see Quick Start |
| Terraform | 1.5+ | `brew install terraform` | [hashicorp.com](https://developer.hashicorp.com/terraform/install) | [hashicorp.com](https://developer.hashicorp.com/terraform/install) |
| WSL 2 | Any | — | `wsl --install` (PowerShell Admin) | — |
