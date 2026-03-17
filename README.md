# enterprise-ai

Enterprise Agentic AI platform — monorepo. Multi-cloud (Azure + AWS) via LiteLLM, with MCP tools, OPA policy enforcement, Redis caching, context compaction, and OpenTelemetry observability. All cross-cutting concerns (security, caching, compaction, observability) live in the shared `platform-sdk` so every new agent or MCP server inherits them automatically.

Two production-grade agents ship in this repo: the **generic Chat Agent** (ReAct loop over a secure SQL tool) and the **RM Prep Agent** (multi-step LangGraph orchestrator that pulls CRM, payments, and news data in parallel and synthesises a client brief).

## Repository Structure

```
enterprise-ai/
├── agents/                      Generic chat agent service (LangGraph + FastAPI)
│   └── src/
│       ├── server.py            FastAPI server — auth, /chat endpoint
│       ├── graph.py             LangGraph ReAct agent builder
│       ├── mcp_bridge.py        MCP SSE client + LangChain tool adapter
│       └── prompts/             Jinja2 system prompt templates
│
├── agents/rm-prep/              RM Prep orchestrator — multi-step brief-writing agent
│   └── src/
│       ├── server.py            FastAPI server — JWT auth, /brief endpoint
│       ├── graph.py             LangGraph StateGraph (parse → route → gather × 3 → synthesize)
│       ├── state.py             RMPrepState TypedDict
│       ├── brief.py             RMBrief Pydantic model + Markdown renderer
│       └── prompts/             Jinja2 templates for each specialist node
│
├── frontends/
│   ├── chat-ui/                 Chainlit web chat UI (generic agent)
│   └── rm-prep-ui/              Streamlit brief-writing UI (RM Prep agent)
│       ├── app.py               JWT login, persona selector in test mode, brief display
│       └── requirements.txt
│
├── tools/                       MCP backend tool servers
│   ├── data-mcp/                Secure read-only SQL tool (generic agent)
│   ├── salesforce-mcp/          Salesforce CRM summary — 7-query profile per client
│   ├── payments-mcp/            Bank payment analytics — volumes, trends, compliance
│   ├── news-search-mcp/         Company news via Tavily API (mock fallback for dev)
│   ├── shared/
│   │   └── mcp_auth.py          Starlette middleware + ContextVar for AgentContext
│   └── policies/opa/
│       ├── tool_auth.rego       Generic data-mcp policy (session + role checks)
│       ├── tool_auth_test.rego  OPA unit tests
│       └── rm_prep_authz.rego   RM Prep policy — row/column security per RM role
│
├── platform-sdk/                Shared Python package — installed into every service
│   └── platform_sdk/
│       ├── __init__.py          Public API
│       ├── auth.py              AgentContext — JWT-backed identity and permission claims
│       ├── config.py            AgentConfig, MCPConfig — typed env-var config
│       ├── security.py          OpaClient, make_api_key_verifier
│       ├── cache.py             ToolResultCache, cached_tool decorator
│       ├── compaction.py        make_compaction_modifier — context window trimming
│       └── agent.py             build_agent, build_specialist_agent — LangGraph factories
│
├── platform/
│   ├── config/                  LiteLLM YAML configs — local and prod
│   └── db/
│       ├── init.sql             Base extensions + roles
│       ├── rm_prep_schema.sql   RM Prep application tables
│       ├── rm_prep_seed.sql     RM Prep seed data
│       ├── 20_test_sfcrm_schema.sql   Test: salesforce.* schema (15 tables)
│       ├── 21_test_sfcrm_seed.sql     Test: load from testdata/sfcrm/*.csv
│       ├── 30_test_bankdw_schema.sql  Test: bankdw.* schema (5 tables)
│       └── 31_test_bankdw_seed.sql    Test: load from testdata/bankdw/*.csv
│
├── testdata/                    Synthetic CSV fixtures (Fortune 500 names, fake data)
│   ├── sfcrm/                   15 Salesforce object CSVs (Account, Contact, Opportunity…)
│   ├── bankdw/                  5 bank DW CSVs (fact_payments, dim_party, dim_bank…)
│   ├── sfcrm_schema.csv         Schema reference for sfcrm tables
│   └── bankdw_schema.csv        Schema reference for bankdw tables
│
├── tests/
│   └── fixtures/test_tokens.py  JWT test personas (alice_rm, bob_senior_rm, dan_compliance…)
│
├── docs/
│   ├── RM_PREP_ORCHESTRATION_DESIGN.md
│   └── RM_PREP_PHASE1_ANALYSIS.md
│
├── docker-compose.yml           Base stack (23 services)
├── docker-compose.test.yml      Test overlay — adds salesforce/bankdw schemas to pgvector
└── infra/
    ├── helm/                    Helm charts
    └── terraform/               AWS RDS (pgvector) provisioning
```

## Quick Start (Local)

### First-time setup

```bash
# 1. Install prerequisites (macOS — see Prerequisites table for Linux equivalents)
brew install opa skaffold helm terraform
# Install Docker Desktop from docker.com, Python 3.11+ from python.org

# 2. Install the shared SDK in editable mode
make sdk-install

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in AZURE_API_KEY, AZURE_API_BASE, POSTGRES_PASSWORD,
# REDIS_PASSWORD, and generate INTERNAL_API_KEY with:
#   python -c "import secrets; print('sk-ent-' + secrets.token_hex(24))"
```

### Start the stack

```bash
# Full stack WITH Salesforce + bankdw test data (recommended for local dev):
make dev-test-up

# Generic chat agent only (no CRM/payments schemas):
make dev-up
```

After `make dev-test-up`:

| Interface | URL | Notes |
|---|---|---|
| RM Prep UI | http://localhost:8502 | Persona selector visible (SHOW_TEST_LOGIN=true) |
| Chat UI | http://localhost:8501 | Any username / INTERNAL_API_KEY |
| Agent REST API | http://localhost:8000 | Bearer INTERNAL_API_KEY |
| RM Prep Agent API | http://localhost:8003 | Bearer JWT (use test_tokens.py) |
| LiteLLM Proxy | http://localhost:4000 | |
| Data MCP | http://localhost:8080 | |
| Salesforce MCP | http://localhost:8081 | |
| Payments MCP | http://localhost:8082 | |
| News MCP | http://localhost:8083 | |

### Windows (WSL 2)

```powershell
# In PowerShell (run as Administrator)
wsl --install
# Restart when prompted.
```

Enable Docker Desktop → Settings → Resources → WSL Integration → your Ubuntu distro → Apply & Restart.

```bash
# Inside Ubuntu
sudo apt update && sudo apt install -y python3-full make curl

# OPA CLI
curl -L -o opa https://github.com/open-policy-agent/opa/releases/download/v0.65.0/opa_linux_amd64_static \
  && chmod +x opa && sudo mv opa /usr/local/bin/opa

cd /mnt/c/users/you/work/enterprise-ai
git config core.autocrlf false   # Docker requires Unix line endings
make sdk-install
cp .env.example .env
nano .env
make dev-test-up
```

## Common Commands

| Command | Description |
|---|---|
| `make dev-test-up` | Start full stack with Salesforce + bankdw test fixtures (use for local dev) |
| `make dev-up` | Start stack without test fixtures (generic chat agent only) |
| `make dev-down` | Stop all containers |
| `make dev-reset` | Wipe pgdata volume and restart fresh (run once after switching from dev-up to dev-test-up) |
| `make dev-logs` | Follow all container logs |
| `make dev-restart` | Restart all containers |
| `make test` | Run all tests (Python + OPA) |
| `make test-policies` | Run OPA policy unit tests only |
| `make lint` | Run ruff linter |
| `make sdk-install` | Install platform-sdk in editable mode |
| `make k8s-dev` | Deploy to dev Kubernetes cluster |
| `make k8s-prod` | Deploy to production |
| `make clean` | Remove caches, build artifacts, and .venv |

## Architecture

### Generic Chat Agent

```
 curl / Chat UI :8501
        │
   ┌────▼────────────────────────────┐
   │  Agent Service  :8000            │
   │  agents/src/server.py            │
   │  · Bearer auth (SDK)             │
   │  · LangGraph ReAct loop          │
   └────┬──────────────────┬──────────┘
        │ LLM calls        │ MCP (SSE)
        ▼                  ▼
 ┌────────────┐   ┌────────────────────┐
 │ LiteLLM    │   │  Data MCP  :8080   │
 │ :4000      │   │  tools/data-mcp/   │
 │ Azure/AWS  │   │  · OpaClient (SDK) │
 └────────────┘   │  · ToolCache (SDK) │
                  └─────────┬──────────┘
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                     ▼
 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
 │ PostgreSQL   │   │ OPA  :8181   │   │ Redis        │
 │ :5432        │   │ tool_auth    │   │ · LLM cache  │
 │ · memory     │   │ .rego        │   │ · tool cache │
 └──────────────┘   └──────────────┘   └──────────────┘
```

### RM Prep Agent

```
 RM Prep UI :8502  (Streamlit + JWT)
        │  Bearer <JWT>
   ┌────▼─────────────────────────────────┐
   │  RM Prep Agent  :8003                 │
   │  agents/rm-prep/src/server.py         │
   │  AgentContext.from_jwt(token)         │
   │                                       │
   │  LangGraph StateGraph:                │
   │  parse_intent → route                 │
   │       └── gather_crm ─────────────┐  │
   │            ├── gather_payments    │  │
   │            └── gather_news        │  │
   │                  └─── synthesize ─┘  │
   │                        └─ format_brief│
   └──────┬────────────┬──────────┬───────┘
    SSE   │            │          │   X-Agent-Context header
          ▼            ▼          ▼   (base64 AgentContext)
  ┌──────────┐ ┌──────────┐ ┌──────────────┐
  │ SF MCP   │ │ Pay MCP  │ │ News MCP     │
  │ :8081    │ │ :8082    │ │ :8083        │
  │salesforce│ │bankdw.*  │ │ Tavily API   │
  │ schema   │ │ schema   │ │ (mock in dev)│
  └────┬─────┘ └────┬─────┘ └──────────────┘
       │             │
       └──────┬──────┘
              ▼
   ┌──────────────────┐    ┌──────────────────┐
   │  PostgreSQL :5432 │    │  OPA  :8181      │
   │  · salesforce.*   │    │  rm_prep_authz   │
   │  · bankdw.*       │    │  row + col masks │
   └──────────────────┘    └──────────────────┘
```

**Authorization chain:** The JWT is verified once at the API boundary. The resulting `AgentContext` (role, assigned_account_ids, compliance_clearance) is forwarded to every MCP call as `X-Agent-Context`. Each MCP server reads it and applies OPA row-level and column-level filters before querying PostgreSQL. `standard` role masks all AML and sanctions columns; `aml_view` unmasks AML; `compliance_full` unmasks everything.

## The Platform SDK

All cross-cutting concerns are in `platform-sdk/platform_sdk/`. Services import what they need — there is no boilerplate to copy.

| Module | What it provides | Used by |
|---|---|---|
| `auth` | `AgentContext` — JWT decode, header encode/decode, row/col filter builders | RM Prep agent, MCP servers |
| `config` | `AgentConfig`, `MCPConfig` — typed dataclasses with `from_env()` | All services |
| `security` | `OpaClient`, `make_api_key_verifier()` | Agent services, MCP servers |
| `cache` | `ToolResultCache`, `@cached_tool` | MCP servers |
| `compaction` | `make_compaction_modifier()` | Agent services |
| `agent` | `build_agent()`, `build_specialist_agent()` — LangGraph factories | All agent services |
| `logging` | `configure_logging()`, `get_logger()` | All services |
| `telemetry` | `setup_telemetry()` | All services |

See [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for step-by-step guides to building new agents and MCP servers.

## Test Data Architecture

The `docker-compose.test.yml` overlay adds the `salesforce` and `bankdw` schemas to the existing `pgvector` PostgreSQL instance with zero code changes:

```
make dev-test-up
  ↓
PostgreSQL init.d runs (fresh volume only):
  01-init.sql           → extensions, roles
  02-rm_prep_schema.sql → rm_prep tables
  03-rm_prep_seed.sql   → rm_prep seed data
  20_test_sfcrm_schema.sql → CREATE SCHEMA salesforce + 15 tables
  21_test_sfcrm_seed.sql   → COPY from testdata/sfcrm/*.csv  (45 accounts)
  30_test_bankdw_schema.sql → CREATE SCHEMA bankdw + 5 tables
  31_test_bankdw_seed.sql   → COPY from testdata/bankdw/*.csv (1000 payments)
```

The MCP servers connect to the same PostgreSQL instance in both test and production — no code switches, no adapter abstractions. `make dev-reset` wipes the pgdata volume so init scripts re-run from scratch.

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
