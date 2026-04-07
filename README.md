# Enterprise AI — Agentic Platform

Enterprise AI is an agentic platform for regulated financial-services workflows. It combines:

- Secure agent services built with LangGraph and FastAPI
- MCP tool servers for CRM, payments, news, and SQL access
- A shared `platform-sdk` for auth, policy enforcement, caching, logging, and telemetry
- A local Docker stack for development, testing, and demos

This repository currently includes:

- `ai-agents`: a generic chat agent backed by a secure SQL MCP server
- `chat-ui`: a Chainlit frontend for the generic chat agent
- `analytics-agent`: analytics and insights agent backed by secure data sources
- `analytics-dashboard`: dashboarding and visualization frontend

## Contents

- [What This Repo Contains](#what-this-repo-contains)
- [Quick Start](#quick-start)
- [Verify It Works](#verify-it-works)
- [Local Endpoints](#local-endpoints)
- [Common Commands](#common-commands)
- [How It Works](#how-it-works)
- [Testing Strategy](#testing-strategy)
- [Repository Structure](#repository-structure)
- [Further Reading](#further-reading)

## What This Repo Contains

### Main agents

| Service | Purpose | Default local URL |
|---|---|---|
| `ai-agents` | Generic secure chat agent for SQL-backed workflows | `http://localhost:8000` |
| `analytics-agent` | Analytics and insights agent | `http://localhost:8005` |

### Main frontends

| Frontend | Purpose | Default local URL |
|---|---|---|
| `chat-ui` | Chainlit UI for the generic chat agent | `http://localhost:8501` |
| `analytics-dashboard` | Dashboard and visualization frontend | `http://localhost:3001` |

### MCP tool servers

| MCP server | Purpose | Default local URL |
|---|---|---|
| `data-mcp` | Secure read-only SQL for the generic agent | `http://localhost:8080` |
| `salesforce-mcp` | CRM account summary and relationship context | `http://localhost:8081` |
| `payments-mcp` | Payment analytics and compliance-aware payment profile | `http://localhost:8082` |
| `news-search-mcp` | Company news via Tavily or mock data | `http://localhost:8083` |

## Quick Start

### Prerequisites

This project is developed on **Windows with WSL2** (Windows Subsystem for Linux). All commands must be run inside your WSL terminal, not PowerShell or CMD.

Required tools:

- **Docker Desktop for Windows** with the WSL2 backend enabled (Settings → Resources → WSL Integration → enable your distro)
- Python 3.11+ (installed inside WSL)
- Make (installed inside WSL)
- OPA CLI (installed inside WSL)

Install Python, Make, and OPA inside your WSL terminal:

```bash
# Inside WSL (Ubuntu/Debian)
sudo apt update && sudo apt install python3-full python3-pip make -y

# Install OPA CLI
curl -L -o opa https://github.com/open-policy-agent/opa/releases/download/v0.65.0/opa_linux_amd64_static
chmod +x opa
sudo mv opa /usr/local/bin/opa
```

> **Note:** Docker Desktop must be running on Windows before you start the stack. Containers are managed via Docker Desktop's WSL2 integration — you do not need to install Docker separately inside WSL.

### 1. Create local config

Run this inside your WSL terminal from the project root:

```bash
cp .env.example .env
```

Fill in at least these values in `.env`:

- `AZURE_API_KEY`
- `AZURE_API_BASE`
- `INTERNAL_API_KEY`
- `JWT_SECRET`
- `CONTEXT_HMAC_SECRET`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`

Generate the secrets with:

```bash
python -c "import secrets; print('sk-ent-' + secrets.token_hex(24))"
python -c "import secrets; print(secrets.token_hex(32))"
python -c "import secrets; print(secrets.token_hex(32))"
```

### 2. Install the shared SDK locally

```bash
make sdk-install
```

This creates `.venv/` and installs `platform-sdk` in editable mode.

### 3. Start infrastructure (once)

```bash
make infra-test-up
```

This starts the long-lived infrastructure services (PostgreSQL, Redis, LiteLLM, LangFuse, OPA, OTel) with test data. You only need to run this once — infrastructure survives across `dev-reset` cycles.

### 4. Start application services

```bash
make dev-test-up
```

This builds and starts agents, MCP tools, and frontends. Use `make dev-up` instead if you don't need CRM/payments test fixtures.

### 5. Watch logs if something looks stuck

```bash
make dev-logs       # app service logs
make infra-logs     # infrastructure logs
```

## Verify It Works

### Generic chat path

1. Open [http://localhost:8501](http://localhost:8501) in your Windows browser — Docker Desktop forwards WSL2 ports to Windows automatically
2. Sign in with any username in local development
3. Send a prompt that requires SQL-backed reasoning

### Health checks

Run from your WSL terminal:

```bash
curl http://localhost:8000/health
curl http://localhost:8005/health
```

## Local Endpoints

| Interface | URL | Notes |
|---|---|---|
| Chat UI | `http://localhost:8501` | Chainlit UI for the generic chat agent |
| Analytics Dashboard | `http://localhost:3001` | Analytics and visualization frontend |
| Generic Agent API | `http://localhost:8000` | FastAPI service for `ai-agents` |
| Analytics Agent API | `http://localhost:8005` | FastAPI service for `analytics-agent` |
| LiteLLM Proxy | `http://localhost:4000` | Shared model routing layer |
| OPA | `http://localhost:8181` | Policy engine |
| Data MCP | `http://localhost:8080` | Generic secure SQL |
| Salesforce MCP | `http://localhost:8081` | CRM MCP server |
| Payments MCP | `http://localhost:8082` | Payments MCP server |
| News MCP | `http://localhost:8083` | News MCP server |
| PostgreSQL | `localhost:5432` | Local development database |

## Common Commands

| Command | What it does |
|---|---|
| `make infra-up` | Start infrastructure without test data |
| `make infra-test-up` | Start infrastructure with CRM/payments test data |
| `make infra-down` | Stop infrastructure (preserves volumes) |
| `make infra-reset` | Wipe infrastructure volumes and restart with test data |
| `make infra-logs` | Follow infrastructure logs |
| `make dev-up` | Start app services without test fixtures |
| `make dev-test-up` | Start app services with test config |
| `make dev-down` | Stop app services (infrastructure keeps running) |
| `make dev-reset` | Tear down and restart app services |
| `make dev-logs` | Follow app service logs |
| `make dev-status` | Show app container health status |
| `make test` | Run fast local checks: unit tests + OPA policy tests |
| `make test-unit` | Run unit tests only |
| `make test-integration` | Run integration tests against the Docker stack |
| `make test-evals` | Run LLM-in-the-loop evals |
| `make test-policies` | Run OPA policy tests only |
| `make lint` | Run Ruff |
| `make format` | Auto-format Python source |
| `make cloud-infra` | Provision Azure VM + networking + WAF (Terraform) |
| `make cloud-deploy VM_IP=<ip>` | Deploy to Azure VM via rsync + docker compose |
| `make cloud-status VM_IP=<ip>` | Check service health on Azure VM |
| `make cloud-logs VM_IP=<ip>` | Follow logs on Azure VM |
| `make clean` | Remove local Python caches and `.venv` |

## How It Works

### High-level architecture

```text
Browser / API Client
  └─> API Gateway  (Kong · Auth0 JWT · OPA tool_auth)
        └─> Orchestrator Agent  (LangGraph StateGraph / ReAct)
              ├─> Specialist Agent Node: gather_crm
              │     └─> salesforce-mcp  ->  Salesforce CRM
              ├─> Specialist Agent Node: gather_payments
              │     └─> payments-mcp   ->  Payments API
              ├─> Specialist Agent Node: gather_news
              │     └─> news-search-mcp -> News Search API
              └─> Specialist Agent Node: gather_data
                    └─> data-mcp        ->  PostgreSQL (row-filtered, column-masked)

Cross-cutting concerns (applied at every layer)
  └─> platform-sdk   — AgentContext propagation, OPA checks, cache helpers, telemetry
  └─> OPA            — fail-closed policy evaluation (authz.rego)
  └─> Redis          — tool-result cache, rate-limit counters, session state
  └─> OpenTelemetry  — distributed traces and spans → OTel Collector → LangFuse / Datadog / etc.
```

Orchestrator agents own the workflow and routing logic. They never call data sources directly — they delegate to specialist nodes, each of which calls a single MCP tool server. MCP servers enforce row-level restrictions, column masking, and audit boundaries before touching any backend.

### Core design ideas

#### 1. Shared platform SDK

The `platform-sdk/` package centralizes cross-cutting behavior so every service uses the same patterns for:

- API key verification and HMAC-signed `AgentContext` propagation
- OPA authorization (fail-closed, with `CircuitBreaker` resilience)
- Redis-backed tool-result caching (also circuit-breaker protected)
- Sandboxed prompt loading via `PromptLoader` (prevents SSTI attacks)
- Structured JSON logging and OpenTelemetry tracing
- Typed configuration via `AgentConfig` and `MCPConfig`
- `make_checkpointer()` factory for MemorySaver or AsyncPostgresSaver selection
- Dependency injection protocols (`Authorizer`, `CacheStore`, `LLMClient`, `ToolBridge`, `PortfolioDataSource`)

This keeps service code focused on business logic instead of repeating infrastructure code.

#### 2. MCP for data access

Each data source is wrapped as an MCP server. Agents do not talk directly to CRM or payments databases. Instead they call MCP tools that enforce:

- tool-level authorization
- row-level restrictions
- column masking
- cache policy
- traceable request boundaries

#### 3. Policy as code with OPA

Authorization is delegated to Open Policy Agent rather than embedded ad hoc in service code. That gives you:

- version-controlled policy
- repeatable tests
- a single place to review authorization logic

#### 4. Different agent patterns for different jobs

All agents follow a two-tier pattern: an **orchestrator** drives the workflow, and **specialist nodes** handle focused data-retrieval tasks. Specialist nodes call MCP tools — they never skip that layer to reach databases or APIs directly.

| Agent | Orchestrator pattern | Specialist nodes | MCP tools called |
|---|---|---|---|
| `ai-agents` | ReAct tool-call loop | Single node per tool call | `data-mcp` |
| `analytics-agent` | ReAct tool-call loop | Single node per tool call | `data-mcp` |

### Security model

Authentication and authorization flow:

1. The API boundary authenticates the caller
2. The agent builds an `AgentContext`
3. That context is signed and forwarded as `X-Agent-Context`
4. MCP servers verify the signature
5. OPA decides whether the tool call is allowed
6. Row filters and column masks are applied before data is returned

This avoids forwarding raw user JWTs to every downstream service.

### Resilience model

Infrastructure clients use a reusable `CircuitBreaker` (from `platform_sdk.resilience`) that opens after consecutive failures and recovers after a configurable timeout. Both `OpaClient` and `ToolResultCache` use this pattern, preventing cascading failures when OPA or Redis is temporarily unavailable.

### Caching model

There are two main cache layers:

- LiteLLM semantic cache for model responses
- tool-result caching for MCP tool outputs (Redis-backed, circuit-breaker protected)

This improves latency and reduces repeated work while keeping security decisions centralized.

## Testing Strategy

The repo uses three layers of testing so failures are easier to understand and debug. CI runs via four GitHub Actions workflows: `ci-unit.yml`, `ci-integration.yml`, `ci-evals.yml`, and `ci-deploy.yml`.

### Layer 1: unit tests

Run with:

```bash
make test-unit
```

Focus:

- auth and HMAC helpers
- row-filter and column-mask logic
- circuit-breaker state transitions
- cache-key behavior
- prompt loader rendering
- markdown rendering

### Layer 2: integration tests

Run with:

```bash
make dev-test-up
make test-integration
```

Focus:

- API behavior end-to-end
- OPA policy decisions
- database-backed tool behavior
- seeded local test data (45 CRM accounts, 1000 payments)

### Layer 3: evals

Run with:

```bash
make test-evals
```

Focus:

- synthesis quality
- specialist tool-calling fidelity
- hallucination and grounding checks

## Repository Structure

```text
enterprise-ai/
├── agents/
│   ├── src/                  # Generic chat agent service
│   └── analytics/            # Analytics agent service
├── frontends/
│   ├── chat-ui/              # Chainlit frontend
│   └── analytics-dashboard/  # Analytics visualization frontend
├── tools/
│   ├── data-mcp/             # Secure SQL MCP
│   ├── salesforce-mcp/       # CRM MCP
│   ├── payments-mcp/         # Payments MCP
│   ├── news-search-mcp/      # News MCP
│   └── shared/               # Shared MCP auth helpers
├── platform-sdk/             # Shared SDK (auth, OPA, cache, resilience, prompts, telemetry)
├── platform/                 # DB schema, seed data, LiteLLM, OTel, Nginx config
├── tests/                    # Unit, integration, and eval tests
├── testdata/                 # Synthetic CRM and payments fixtures
├── scripts/                  # Deployment and operational scripts
├── .github/workflows/        # CI: unit, integration, evals, deploy
├── infra/azure/              # Terraform for Azure VM + VNet + NSG + App Gateway with WAF
├── docker-compose.infra.yml             # Infrastructure services (local dev)
├── docker-compose.yml                   # Application services (local dev)
├── docker-compose.cloud.yml             # Combined infra + app for Azure VM deployment
├── docs/docker-compose.infra-test.yml   # Test data overlay for infrastructure
├── docs/docker-compose.test.yml         # Test config overlay for app services
└── Makefile
```

## Troubleshooting First Steps

If the stack is not behaving as expected:

```bash
make infra-status    # check infrastructure health
make dev-status      # check app service health
make dev-logs        # follow app logs
make infra-logs      # follow infrastructure logs
make dev-reset       # restart app services (infra untouched)
```

Useful checks:

- Confirm `.env` exists and required secrets are populated
- Confirm Docker containers are healthy
- Confirm LiteLLM can reach your model provider
- Confirm the database was seeded if you expect CRM/payments test data

If the above steps do not resolve the issue, review the service logs in detail and check that Docker Desktop is running and the WSL2 integration is active for your distro.

## Further Reading

- [docs/DEPLOY.md](docs/DEPLOY.md) for Azure cloud deployment
- [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) for adding new agents and MCP servers
- [`docs/`](docs/) for additional architecture and design notes
