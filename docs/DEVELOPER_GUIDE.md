# Developer Guide — Enterprise AI Agentic Platform

This guide is the primary reference for engineers building on the Enterprise AI platform. It covers local environment setup, how the platform SDK works, and step-by-step walkthroughs for building new agents and MCP servers.

---

## Table of Contents

1. [Local Development Setup](#1-local-development-setup)
2. [Platform SDK — Separation of Concerns](#2-platform-sdk--separation-of-concerns)
3. [Authorization Chain — JWT → AgentContext → OPA → PostgreSQL](#3-authorization-chain--jwt--agentcontext--opa--postgresql)
4. [Test Data Architecture](#4-test-data-architecture)
5. [Step-by-Step: Building a New Agent](#5-step-by-step-building-a-new-agent)
6. [Step-by-Step: Building a New MCP Server](#6-step-by-step-building-a-new-mcp-server)
7. [Component Reference](#7-component-reference)
8. [Environment Variables](#8-environment-variables)
9. [CI/CD Pipeline](#9-cicd-pipeline)
10. [Data Flows](#10-data-flows)

---

## 1. Local Development Setup

### 1.1 Prerequisites

Install these once. All versions are minimum requirements.

| Tool | Minimum version | macOS | Ubuntu / WSL 2 |
|---|---|---|---|
| Docker Desktop | Latest | [docker.com](https://docker.com) | [docker.com](https://docker.com) |
| Python | 3.11 | `brew install python@3.11` | `apt install python3-full python3-venv` |
| Make | Any | pre-installed | `apt install make` |
| OPA CLI | 0.65 | `brew install opa` | see below |
| Git | 2.x | pre-installed | `apt install git` |

**OPA CLI on Ubuntu / WSL 2:**
```bash
curl -L -o opa \
  https://github.com/open-policy-agent/opa/releases/download/v0.65.0/opa_linux_amd64_static
chmod +x opa && sudo mv opa /usr/local/bin/opa
opa version   # → OPA 0.65.0
```

**WSL 2 additional steps (Windows only):**
```powershell
# PowerShell (run as Administrator)
wsl --install
# Restart when prompted, then in Ubuntu:
```
```bash
sudo apt update && sudo apt install -y python3-full python3-venv make curl git
# Enable Docker Desktop → Settings → Resources → WSL Integration → your Ubuntu distro → Apply
```

> **Line endings:** Run `git config core.autocrlf false` inside WSL before cloning. Docker images require Unix line endings.

---

### 1.2 First-time Setup

```bash
# 1. Clone the repo
git clone <repo-url> enterprise-ai
cd enterprise-ai

# 2. Install the shared SDK into a local venv
make sdk-install
# This creates .venv/ and installs platform-sdk in editable mode.
# Activate it for IDE import resolution:
source .venv/bin/activate   # or .venv\Scripts\Activate.ps1 on Windows

# 3. Configure environment variables
cp .env.example .env
```

Open `.env` and fill in the required values:

```bash
# LLM provider — choose Azure (recommended) or AWS
AZURE_API_KEY=your-azure-key
AZURE_API_BASE=https://your-instance.openai.azure.com

# Infrastructure secrets — generate these
INTERNAL_API_KEY=$(python -c "import secrets; print('sk-ent-' + secrets.token_hex(24))")
JWT_SECRET=$(python -c "import secrets; print(secrets.token_hex(32))")
POSTGRES_PASSWORD=$(python -c "import secrets; print(secrets.token_hex(16))")
REDIS_PASSWORD=$(python -c "import secrets; print(secrets.token_hex(16))")

# Optional — for live news in development
TAVILY_API_KEY=tvly-...
```

---

### 1.3 Start Infrastructure (once)

```bash
make infra-test-up
```

This starts the long-lived infrastructure tier: PostgreSQL, Redis, LiteLLM, LangFuse, OPA, and OpenTelemetry collector. The `infra-test-up` variant seeds CRM and payments test data (recommended). You only run this once — infrastructure survives across `dev-reset` cycles.

On first start, Docker will pull images and LangFuse runs Prisma migrations (2–5 minutes on WSL). Once LangFuse is ready, open [http://localhost:3001](http://localhost:3001), create your account and project, then copy the API keys from **Settings > API Keys** into `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` in your `.env` file.

**Infrastructure services:**

| Service | Port | Purpose |
|---|---|---|
| PostgreSQL | 5432 | Primary data store |
| Redis | 6379 | Cache + session store |
| LiteLLM Proxy | 4000 | Multi-cloud LLM router |
| LangFuse | 3001 | LLM tracing + prompt management |
| OPA | 8181 | Authorization policy engine |
| OTel Collector | 4318 | Trace aggregation |

### 1.4 Start Application Services

```bash
make dev-test-up
```

This builds and starts agents, MCP tools, and frontends. Use `make dev-up` if you don't need the JWT/HMAC test config overlay.

**Application services:**

| Service | Port | Purpose |
|---|---|---|
| Chat UI | 8501 | Chainlit generic chat |
| Generic Agent | 8000 | ReAct chat API |
| Analytics Agent | 8086 | Analytics and insights agent |
| Analytics Dashboard | 3003 | Analytics visualization frontend |
| Data MCP | 8080 | Generic SQL tool server |
| Salesforce MCP | 8081 | CRM data tool server |
| Payments MCP | 8082 | Bank payment tool server |
| News MCP | 8083 | News search tool server |

Verify everything is healthy:
```bash
make infra-status                                      # check infrastructure
make dev-status                                        # check app services
curl http://localhost:8000/health                      # → {"status":"ok"}
curl http://localhost:8181/health                      # → {}
curl http://localhost:4000/health                      # → {"status":"healthy"}
```

---

### 1.5 Day-to-day Commands

```bash
# Infrastructure (start once, leave running)
make infra-test-up   # Start infrastructure with test data (recommended)
make infra-up        # Start infrastructure without test data
make infra-down      # Stop infrastructure (preserves volumes)
make infra-reset     # Wipe volumes and restart infrastructure
make infra-logs      # Follow infrastructure logs
make infra-status    # Show infrastructure health

# Application services (rebuild frequently)
make dev-test-up     # Start app services with test config
make dev-up          # Start app services without test config
make dev-down        # Stop app services (infrastructure keeps running)
make dev-reset       # Tear down and restart app services
make dev-logs        # Follow app service logs
make dev-restart     # Restart app containers (no rebuild)
make sdk-install     # Rebuild the venv after platform-sdk changes

# Testing
make test            # Unit tests + OPA policy tests — no Docker required
make test-unit       # Layer 1 only (seconds, no external deps)
make test-integration # Layer 2 — requires infra-test-up + dev-test-up
make test-evals      # Layer 3 — requires full stack + LLM creds
make test-policies   # OPA policy unit tests only
make lint            # ruff linter across all Python
```

> **When to run `make infra-reset`:** Any time you change a database init script (`platform/db/`), change the schema, or need to re-seed test data. The `pgdata` Docker volume must be wiped for init scripts to re-run. Note: `make dev-reset` only restarts app services — it does not touch infrastructure or database volumes.

---

### 1.5 Generate Test Tokens for Manual API Testing

```bash
# Print all available test JWT tokens:
python tests/fixtures/test_tokens.py

# Use a manager token to generate a brief:
TOKEN=$(python -c "
from tests.fixtures.test_tokens import get_token
print(get_token('carol_manager'))
")

curl -s -X POST http://localhost:8003/brief/persona \
  -H "Authorization: Bearer ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"prompt\": \"Prepare a pre-meeting brief for Microsoft Corp.\",
    \"rm_id\": \"dev-test\",
    \"session_id\": \"local-001\",
    \"jwt_token\": \"${TOKEN}\"
  }" | python -m json.tool
```

Available test personas and their access levels:

| Persona | Role | Accounts | AML visible | Compliance visible |
|---|---|---|---|---|
| `alice_rm` | rm | 4 assigned | no | no |
| `bob_senior_rm` | senior_rm | all | yes | no |
| `carol_manager` | manager | all | yes | no |
| `dan_compliance` | compliance_officer | all | yes | yes |
| `grace_readonly` | readonly | none | — | — |

---

### 1.6 Running Tests Locally

```bash
# Layer 1 — unit tests (no Docker, no LLM, runs in ~5 seconds)
source .venv/bin/activate
pytest tests/unit/ -m unit -v

# OPA policy tests
opa test tools/policies/opa/ -v

# Layer 2 — integration tests (requires make dev-test-up first)
pytest tests/integration/ -m integration -v --timeout=60

# Layer 3 — eval tests (requires full stack + LLM credentials in .env)
pytest tests/evals/ -m "eval and slow" -v --timeout=300

# Run a single test class:
pytest tests/unit/test_auth.py::TestAgentContextColumnMasking -v

# Run a specific eval case:
pytest tests/evals/test_faithfulness.py::TestFaithfulnessMicrosoftManager -v
```

---

### 1.7 IDE Setup (VS Code / PyCharm)

After `make sdk-install`, point your IDE at `.venv/bin/python` (or `.venv\Scripts\python.exe` on Windows). This gives you import completion for `platform_sdk` across all services.

For VS Code, add to `.vscode/settings.json`:

```json
{
  "python.defaultInterpreterPath": "${workspaceFolder}/.venv/bin/python",
  "python.analysis.extraPaths": [
    "${workspaceFolder}/platform-sdk"
  ]
}
```

---

## 2. Platform SDK — Separation of Concerns

### Why a shared SDK?

Without a shared SDK every new service independently implements API key verification, OPA calls, Redis connection management, context window trimming, structured logging, and OpenTelemetry tracing. Each reimplementation is a chance for divergence, bugs fixed in one place but not others, and security properties that vary across services.

The `platform-sdk` collapses all cross-cutting concerns into one tested, versioned package. Service code imports what it needs; it never reimplements any of these.

```
platform-sdk/platform_sdk/
│
├── auth.py            — "Who is calling, and what are they allowed to see?"
├── config.py          — "What does this service need to know about itself?"
├── security.py        — "Is this specific request authorized?" (uses CircuitBreaker)
├── cache.py           — "Have we computed this result recently?" (uses CircuitBreaker)
├── resilience.py      — Reusable CircuitBreaker for fail-fast + auto-recovery
├── prompts.py         — Sandboxed Jinja2 PromptLoader (prevents SSTI)
├── compaction.py      — "Is the context window getting too full?"
├── agent.py           — Agent/specialist factories + make_checkpointer()
├── protocols.py       — DI protocols: Authorizer, CacheStore, LLMClient, ToolBridge, PortfolioDataSource
├── mcp_server_base.py — BaseMCPServer and shared health router
├── mcp_bridge.py      — SSE client for MCP tool servers → LangChain tools
├── metrics.py         — OPA/cache/MCP Prometheus-style metric recorders
├── logging.py         — "Write structured JSON logs with keyword args"
└── telemetry.py       — "Emit OpenTelemetry traces automatically"
```

A new MCP tool server needs roughly 80 lines of service code to be fully production-ready. The SDK handles the rest.

---

### `auth.py` — AgentContext

`AgentContext` is the central identity object. It carries the verified identity and permission claims for one user session and is the single source of truth for all downstream authorization decisions.

```python
from platform_sdk import AgentContext

# At the API boundary — verify once:
ctx = AgentContext.from_jwt(request.headers["Authorization"].removeprefix("Bearer "))
# ctx.rm_id, ctx.role, ctx.assigned_account_ids, ctx.compliance_clearance

# Development bypass (AUTH_MODE=none in .env):
ctx = AgentContext.anonymous()   # full-access context, no JWT needed

# Forward to MCP tools via HMAC-signed X-Agent-Context header:
bridge = MCPToolBridge(mcp_url, agent_context=ctx)

# Inside an MCP tool handler:
from tools.shared.mcp_auth import get_agent_context
ctx = get_agent_context()
if not ctx.can_access_account(account_id):
    return json.dumps({"error": "access_denied"})

# Build filters for SQL queries:
row_filter = ctx.build_row_filters_crm()       # {"Account": ["001AAA", "002BBB"]}
col_mask   = ctx.build_col_mask()              # ["AMLRiskCategory", "SanctionsScreeningStatus"]
clearance  = ctx.has_clearance("aml_view")     # True / False
```

The context is **HMAC-signed** when forwarded downstream. MCP servers verify the signature before trusting the context, which prevents a compromised agent from forging a higher-clearance identity.

---

### `config.py` — Typed configuration

Two dataclasses — `AgentConfig` for agents and `MCPConfig` for MCP servers — each with a `from_env()` classmethod that reads and validates all environment variables once at startup.

```python
from platform_sdk import AgentConfig, MCPConfig

# In an agent service:
config = AgentConfig.from_env()
# config.model_route        — LiteLLM route name
# config.recursion_limit    — max tool-call iterations
# config.enable_compaction  — bool
# config.specialist_model_route

# In an MCP server:
config = MCPConfig.from_env()
# config.opa_url            — OPA decision endpoint
# config.opa_timeout_seconds
# config.max_result_bytes   — response size cap
```

---

### `security.py` — OPA and API key verification

```python
from platform_sdk import OpaClient, MCPConfig, make_api_key_verifier

# OPA client — fail-closed: OPA unreachable → deny
# Internally uses CircuitBreaker — after 5 consecutive failures, the circuit
# opens and calls are short-circuited for 30s before allowing a probe.
opa = OpaClient(MCPConfig.from_env())
allowed = await opa.authorize("my_tool", {"session_id": sid, "role": role})
if not allowed:
    return "ERROR: Unauthorized."

# FastAPI Bearer key dependency
verify_api_key = make_api_key_verifier()

@app.post("/brief")
async def brief(body: BriefRequest, _: str = Depends(verify_api_key)):
    ...
```

Both helpers are fail-closed by design. An unconfigured `INTERNAL_API_KEY` rejects all requests. OPA returning a network error is treated as a denial. The `CircuitBreaker` (from `platform_sdk.resilience`) prevents thundering-herd retries when OPA is temporarily down.

---

### `resilience.py` — Circuit breaker

```python
from platform_sdk import CircuitBreaker

cb = CircuitBreaker(name="opa", failure_threshold=5, recovery_timeout=30.0)

if cb.is_open:
    return False  # fail fast — don't hit the downstream

try:
    result = await do_something()
    cb.record_success()
except TransientError:
    cb.record_failure()
```

Used internally by `OpaClient` and `ToolResultCache`. Also available for custom infrastructure clients.

---

### `prompts.py` — Sandboxed prompt loading

```python
from platform_sdk.prompts import PromptLoader

# Production: load from the service's prompts/ directory
prompts = PromptLoader.from_directory(Path("src/prompts"))
text = prompts.render("router.j2", client_name="Acme", has_brief=True)

# Tests: inject a loader pointing at test-only templates
test_prompts = PromptLoader.from_directory(Path("tests/fixtures/prompts"))
graph = build_rm_orchestrator(prompts=test_prompts)
```

Uses Jinja2's `SandboxedEnvironment` to prevent server-side template injection (SSTI). The loader is a frozen dataclass — safe to share across async requests.

---

### `cache.py` — Tool result caching

Results are stored in Redis keyed by `sha256(tool_name + canonical_args)`. The cache degrades gracefully — if Redis is unavailable, tools run normally without caching.

```python
from platform_sdk import ToolResultCache
from platform_sdk.cache import make_cache_key

_cache = ToolResultCache.from_env(ttl_seconds=1800)

@mcp.tool()
async def get_client_profile(client_name: str) -> str:
    key = make_cache_key("get_client_profile", {"client_name": client_name})
    if _cache:
        cached = await _cache.get(key)
        if cached:
            return cached

    result = await _fetch_from_db(client_name)

    # Never cache errors — callers should get fresh retries on errors
    if _cache and not result.startswith('{"error"'):
        await _cache.set(key, result)

    return result
```

> **Cache key isolation:** Always include clearance-level information in the key when the same tool returns different data for different clearance levels. See `payments-mcp` for the `col_mask_key` pattern.

---

### `security.py` — `make_api_key_verifier`

```python
verify_api_key = make_api_key_verifier()

@app.post("/chat")
async def chat(body: ChatRequest, _: str = Depends(verify_api_key)):
    ...
```

Reads `INTERNAL_API_KEY` from the environment. Uses a timing-safe comparison to prevent timing attacks. Returns 401 with no body on failure.

---

### `agent.py` — LangGraph factories and checkpointer

`make_checkpointer(config)` — selects the right checkpointer backend:

```python
from platform_sdk import make_checkpointer, AgentConfig

config = AgentConfig.from_env()
checkpointer = make_checkpointer(config)
# Returns AsyncPostgresSaver if config.checkpointer_type == "postgres"
# and checkpointer_db_url is set; otherwise falls back to MemorySaver.
```

Set `CHECKPOINTER_TYPE=postgres` and `CHECKPOINTER_DB_URL=postgresql://...` in `.env` for persistent checkpointing.

`build_agent(tools, config, prompt)` — ReAct loop for interactive agents:

```python
from platform_sdk import AgentConfig, build_agent
from langchain_core.messages import HumanMessage

config = AgentConfig.from_env()
agent  = build_agent(tools, config=config, prompt=system_prompt)

result = await agent.ainvoke(
    {"messages": [HumanMessage(content=user_message)]},
    config={"recursion_limit": config.recursion_limit,
            "configurable": {"thread_id": session_id}},
)
reply = result["messages"][-1].content
```

`build_specialist_agent(tools, config, prompt, model_override)` — single-domain sub-agent for StateGraph nodes:

```python
from platform_sdk import build_specialist_agent

crm_agent = build_specialist_agent(
    tools         = sf_tools,
    config        = config,
    prompt        = crm_prompt,
    model_override = config.specialist_model_route,   # Haiku
)
result = await crm_agent.ainvoke({"messages": [HumanMessage(content=f"Client: {name}")]})
```

---

### `compaction.py` — Context window trimming

```python
from platform_sdk.compaction import make_compaction_modifier

modifier = make_compaction_modifier(config)
# Passed automatically when using build_agent() — not usually needed directly.
```

Trims oldest messages when the token count approaches `config.context_token_limit`. Always preserves the system message.

---

### `logging.py` and `telemetry.py` — Observability

```python
from platform_sdk import configure_logging, get_logger, setup_telemetry

configure_logging()                         # set up structlog JSON output
setup_telemetry("my-service-name")          # configure OTel SDK + exporters
log = get_logger(__name__)

log.info("tool_called", client=name, duration_ms=42, cached=False)
# → {"event": "tool_called", "client": "...", "duration_ms": 42, "cached": false, "timestamp": "..."}
```

Call `configure_logging()` and `setup_telemetry()` at startup (e.g. in `lifespan()`). `setup_telemetry()` initialises the OTel SDK and auto-instruments LangChain/LangGraph and OpenAI calls via OpenLLMetry. All traces flow through the OTel Collector which exports to the configured backend (LangFuse by default, but swappable to Datadog, Honeycomb, etc. by editing `platform/otel/otel-local.yaml` — no application code changes). The LangFuse SDK is retained only for prompt management via `get_langfuse()`. Do **not** use `get_langfuse_callback_handler()` — it is deprecated and returns `None`.

---

## 3. Authorization Chain — JWT → AgentContext → OPA → PostgreSQL

```
HTTP request
     │
     ├─ 1. Bearer token verified by make_api_key_verifier() or from_jwt()
     ├─ 2. JWT decoded → AgentContext (role, clearance, assigned_accounts)
     ├─ 3. AgentContext HMAC-signed → X-Agent-Context header on MCP calls
     ├─ 4. MCP middleware: HMAC verified, context decoded into ContextVar
     ├─ 5. OPA called: allow? + row_filters + col_mask returned
     └─ 6. SQL: WHERE AccountId = ANY($ids) + NULLed columns applied
```

### Role and clearance matrix

| Role | Row scope | AML columns | Compliance columns |
|---|---|---|---|
| `readonly` | none (tool denied entirely) | — | — |
| `rm` | assigned_account_ids only | masked (null) | masked (null) |
| `senior_rm` | all accounts | visible | masked (null) |
| `manager` | all accounts | visible | masked (null) |
| `compliance_officer` | all accounts | visible | visible |

OPA policies return a structured `result` object — not just a boolean:

```json
{
  "allow": true,
  "reason": "",
  "row_filters": { "Account": ["001AAA", "002BBB"] },
  "col_mask":   ["AMLRiskCategory", "SanctionsScreeningStatus", "PEPFlag"]
}
```

MCP servers apply both filters in SQL, never in Python, to avoid loading restricted data into memory before filtering it out.

### Why HMAC-signed context instead of JWT forwarding

Forwarding the user's JWT to MCP servers would require distributing the JWT signing secret to every MCP server. Instead, agents sign the `AgentContext` with a separate `AGENT_CONTEXT_SECRET`. MCP servers share only this secret — they cannot forge a context with higher clearance because the HMAC would not verify. If an MCP server is compromised, it cannot elevate its own access.

---

## 4. Test Data Architecture

The `docker-compose.infra-test.yml` overlay adds synthetic CRM and payments data to the same PostgreSQL instance used in development, with zero code changes between test and production environments. The `docker-compose.test.yml` overlay adds JWT/HMAC test configuration to the application services.

### How PostgreSQL init works

On the **first start of a fresh volume**, PostgreSQL runs every file in `/docker-entrypoint-initdb.d/` alphabetically:

```
01-init.sql                    → extensions (pgvector, uuid-ossp), roles
02-agent_schema.sql            → agent-specific tables (sessions, state)
03-agent_seed.sql              → initial seed data
20_test_sfcrm_schema.sql       → salesforce.* schema + 15 tables
21_test_sfcrm_seed.sql         → COPY FROM testdata/sfcrm/*.csv  (45 accounts)
30_test_bankdw_schema.sql      → bankdw.* schema + 5 tables
31_test_bankdw_seed.sql        → COPY FROM testdata/bankdw/*.csv (1,000 payments)
```

> Init scripts only run once per volume. After any schema change, run `make infra-reset` to wipe the volume and re-run.

### Cross-domain identity spine

Every account in `sfcrm/Account.csv` has a matching row in `bankdw/dim_party.csv` by `Name = PartyName`. This is the join key that lets `payments-mcp` look up payment data given only a company name from Salesforce.

### Test data coverage

| File | Rows | Coverage |
|---|---|---|
| `sfcrm/Account.csv` | 45 | Fortune 500 companies across all major industries |
| `sfcrm/Contact.csv` | ~180 | 4 contacts per account |
| `sfcrm/Opportunity.csv` | ~135 | 3 open opportunities per account |
| `sfcrm/Task.csv` + `Event.csv` | ~315 | Recent activity history |
| `sfcrm/Case.csv` + `Contract.csv` | ~90 | Service + contract records |
| `bankdw/fact_payments.csv` | 1,000 | Synthetic payment transactions |
| `bankdw/dim_party.csv` | 45 | Compliance profiles (varied: AML:High, KYC:Pending, PEP-flagged) |
| `bankdw/dim_bank.csv` | 8 | Realistic US correspondent banks |
| `bankdw/dim_product.csv` | 4 | ACH, Wire, RTP, SWIFT rails |

Compliance profiles are deliberately varied so tests exercise column masking at every clearance level — some accounts are high AML risk, some PEP-flagged, some clean. This ensures the masking logic is exercised rather than trivially passing because all test data is clean.

---

## 5. Step-by-Step: Building a New Agent

This section covers two patterns: a **ReAct agent** (interactive, tool-calling loop) and a **StateGraph orchestrator** (deterministic, parallel fan-out). Choose the right pattern for your use case before starting.

| Use ReAct when... | Use StateGraph when... |
|---|---|
| The user drives tool selection interactively | Every domain must always be checked |
| The number of tool calls is unbounded | The workflow has a fixed shape |
| You need a conversational back-and-forth | You need auditable, reproducible outputs |
| Example: generic Q&A, data exploration | Example: RM brief, credit memo, compliance report |

---

### Pattern A: ReAct Agent (Interactive)

This walkthrough builds a **Contract Review Agent** — an RM asks questions about their clients' active contracts and the agent retrieves and explains them.

#### Step 1 — Project structure

```bash
mkdir -p agents/contract-review/src/prompts
touch agents/contract-review/src/__init__.py
touch agents/contract-review/src/server.py
touch agents/contract-review/src/graph.py
touch agents/contract-review/Dockerfile
touch agents/contract-review/requirements.txt
```

#### Step 2 — `requirements.txt`

```
fastapi>=0.111.0
uvicorn[standard]>=0.30.0
langchain-core>=0.2.0
langchain-openai>=0.1.8
langgraph>=0.2.0
httpx>=0.27.0
```

The `platform-sdk` is **not** listed — it is installed by the Dockerfile from the monorepo root.

#### Step 3 — `Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app

# Install the shared SDK first (separate layer — changes rarely)
COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

# Install service dependencies
COPY agents/contract-review/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service source
COPY agents/contract-review/src/ ./src/

CMD ["uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "8004"]
```

#### Step 4 — `src/graph.py`

```python
from pathlib import Path
from platform_sdk import AgentConfig, build_agent
from platform_sdk.prompts import PromptLoader

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_default_prompts = PromptLoader.from_directory(_PROMPTS_DIR)


def build_contract_agent(tools: list, prompts: PromptLoader | None = None):
    """Build a ReAct agent for contract review queries."""
    prompts = prompts or _default_prompts
    config = AgentConfig.from_env()
    prompt = prompts.render("contract_agent.j2",
        tool_names=[t.name for t in tools]
    )
    return build_agent(tools, config=config, prompt=prompt)
```

The `prompts` parameter enables dependency injection — tests can supply a `PromptLoader` pointing at test-only templates.

#### Step 5 — `src/prompts/contract_agent.j2`

```jinja
You are a contract review assistant for relationship managers at a financial institution.
You have access to the following tools: {{ tool_names | join(", ") }}.

When asked about a client's contracts, always:
1. Retrieve the contract data using the available tool.
2. Summarise key terms: value, expiry date, status, and any renewal flags.
3. Flag contracts expiring within 90 days.

Never fabricate contract terms. If data is unavailable, say so clearly.
```

#### Step 6 — `src/server.py`

```python
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from platform_sdk import (
    AgentConfig,
    AgentContext,
    configure_logging,
    get_logger,
    make_api_key_verifier,
    setup_telemetry,
)
from agents.src.mcp_bridge import MCPToolBridge   # reuse shared bridge

from .graph import build_contract_agent

configure_logging()
setup_telemetry(os.getenv("SERVICE_NAME", "contract-review-agent"))
log = get_logger(__name__)

_config = AgentConfig.from_env()
verify_api_key = make_api_key_verifier()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Decode the agent context once at startup for dev convenience;
    # in production, context is injected per-request from the JWT.
    ctx = AgentContext.anonymous() if os.getenv("AUTH_MODE") == "none" else None
    bridge = MCPToolBridge(os.environ["CONTRACTS_MCP_SSE_URL"], agent_context=ctx)
    await bridge.connect()
    tools = await bridge.get_langchain_tools()
    app.state.agent = build_contract_agent(tools)
    app.state.bridge = bridge
    log.info("contract_agent_ready", tool_count=len(tools))
    yield
    await bridge.disconnect()


app = FastAPI(lifespan=lifespan)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=_config.max_message_length)
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()), max_length=128)
    jwt_token: str | None = Field(default=None)     # JWT from agent UI


class ChatResponse(BaseModel):
    content: str
    session_id: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, req: Request, _: str = Depends(verify_api_key)):
    # Build per-request AgentContext from JWT (or anonymous in dev)
    if body.jwt_token and os.getenv("AUTH_MODE") != "none":
        ctx = AgentContext.from_jwt(body.jwt_token)
    else:
        ctx = AgentContext.anonymous()

    log.info("chat_request", session_id=body.session_id, role=ctx.role)

    try:
        result = await req.app.state.agent.ainvoke(
            {"messages": [HumanMessage(content=body.message)]},
            config={
                "recursion_limit": _config.recursion_limit,
                "configurable": {"thread_id": body.session_id},
            },
        )
        return ChatResponse(
            content=result["messages"][-1].content,
            session_id=body.session_id,
        )
    except Exception as exc:
        log.error("chat_error", error=str(exc), session_id=body.session_id)
        raise HTTPException(status_code=500, detail="Internal agent error")
```

#### Step 7 — Register in `docker-compose.yml`

```yaml
  contract-review-agent:
    build:
      context: .
      dockerfile: agents/contract-review/Dockerfile
    container_name: ai-contract-agent
    environment:
      LITELLM_BASE_URL:      http://litellm:4000/v1
      INTERNAL_API_KEY:      ${INTERNAL_API_KEY}
      JWT_SECRET:            ${JWT_SECRET}
      CONTRACTS_MCP_SSE_URL: http://salesforce-mcp:8081/sse
      SERVICE_NAME:          contract-review-agent
      ENABLE_COMPACTION:     "true"
      AUTH_MODE:             ${AUTH_MODE:-jwt}
      <<: *otel-env
    depends_on:
      litellm:        { condition: service_healthy }
      salesforce-mcp: { condition: service_healthy }
    networks: [ai-network]
    ports:
      - "127.0.0.1:8004:8004"
```

#### Step 8 — Write unit tests

Add `tests/unit/test_contract_agent.py` covering:
- Prompt rendering for various tool lists
- Request model validation (message length bounds, session_id defaults)
- Any response parsing logic

Add `tests/evals/test_contract_quality.py` covering:
- Does the brief mention contract expiry dates from the fixture data?
- Does it correctly flag near-expiry contracts?
- Does it avoid fabricating contract values?

---

### Pattern B: StateGraph Orchestrator (Deterministic Multi-domain)

This walkthrough builds a **Credit Memo Agent** — it fetches financial statements (from a hypothetical `financials-mcp`), payment history (`payments-mcp`), and news (`news-mcp`) in parallel, then synthesises a structured credit memo.

All StateGraph agents follow a similar pattern. Refer to the source code of existing agents for a complete reference implementation.

#### Step 1 — Define the state

```python
# agents/credit-memo/src/state.py
from typing import TypedDict, Optional

class CreditMemoState(TypedDict):
    # Input
    client_name:       str
    requested_amount:  float
    rm_id:             str
    session_id:        str
    agent_context_header: str      # X-Agent-Context value, forwarded to MCPs

    # Intermediate outputs — populated by specialist nodes
    financials_output: Optional[str]
    payments_output:   Optional[str]
    news_output:       Optional[str]

    # Final output
    memo_markdown:     Optional[str]
    error:             Optional[str]
```

#### Step 2 — Define the graph

```python
# agents/credit-memo/src/graph.py
from langgraph.graph import StateGraph, END
from .state import CreditMemoState
from .nodes import (
    parse_request,
    gather_financials,
    gather_payments,
    gather_news,
    synthesize_memo,
    format_memo,
)

def build_credit_memo_graph():
    graph = StateGraph(CreditMemoState)

    graph.add_node("parse_request",    parse_request)
    graph.add_node("gather_financials", gather_financials)
    graph.add_node("gather_payments",  gather_payments)
    graph.add_node("gather_news",      gather_news)
    graph.add_node("synthesize_memo",  synthesize_memo)
    graph.add_node("format_memo",      format_memo)

    graph.set_entry_point("parse_request")

    # parse_request → parallel fan-out
    graph.add_edge("parse_request", "gather_financials")
    graph.add_edge("parse_request", "gather_payments")
    graph.add_edge("parse_request", "gather_news")

    # All three specialists → synthesize
    graph.add_edge("gather_financials", "synthesize_memo")
    graph.add_edge("gather_payments",   "synthesize_memo")
    graph.add_edge("gather_news",       "synthesize_memo")

    # synthesize → format → end
    graph.add_edge("synthesize_memo", "format_memo")
    graph.add_edge("format_memo", END)

    return graph.compile()
```

#### Step 3 — Specialist nodes

Each specialist node follows the same pattern:

```python
# agents/credit-memo/src/nodes.py
import json
from langchain_core.messages import HumanMessage
from platform_sdk import AgentConfig, build_specialist_agent

async def gather_payments(state: CreditMemoState) -> dict:
    """Fan-out node: fetch payment history from payments-mcp."""
    from agents.src.mcp_bridge import MCPToolBridge
    from platform_sdk import AgentContext

    # Reconstruct context from the forwarded header
    ctx = AgentContext.from_header(state["agent_context_header"])

    bridge = MCPToolBridge(os.environ["PAYMENTS_MCP_SSE_URL"], agent_context=ctx)
    await bridge.connect()
    tools = await bridge.get_langchain_tools()

    config = AgentConfig.from_env()
    agent  = build_specialist_agent(tools, config, PAYMENTS_PROMPT, config.specialist_model_route)

    result = await agent.ainvoke({
        "messages": [HumanMessage(
            content=f'Call get_payment_summary with client_name="{state["client_name"]}"'
        )]
    })
    await bridge.disconnect()

    output = result["messages"][-1].content
    return {"payments_output": output}
```

#### Step 4 — Structured output model

```python
# agents/credit-memo/src/memo.py
from pydantic import BaseModel
from typing import Optional

class CreditMemo(BaseModel):
    client_name:          str
    requested_amount:     float
    recommended_amount:   Optional[float]
    term_months:          Optional[int]
    key_ratios:           dict[str, str]      # {"debt_equity": "1.2x", ...}
    risk_flags:           list[str]
    recommendation:       str                 # "APPROVE" / "DECLINE" / "REFER"
    summary:              str

    def to_markdown(self) -> str:
        # Render to structured Markdown for downstream consumption
        ...
```

#### Key differences from ReAct

In a StateGraph orchestrator, there is no "decide which tools to call" step. The graph always calls all three specialists. This is the right choice for regulated document generation because:

- A credit committee can verify that financial, payment, and news data were all consulted
- No LLM decision can cause a required data source to be skipped
- The structured `CreditMemo` output is a typed contract, not free text

---

## 6. Step-by-Step: Building a New MCP Server

This walkthrough builds a **Contracts MCP Server** that queries the `salesforce.Contract__c` table. All platform MCP servers follow this pattern.

### Step 1 — Project structure

```bash
mkdir -p tools/contracts-mcp/src
touch tools/contracts-mcp/src/__init__.py
touch tools/contracts-mcp/src/server.py
touch tools/contracts-mcp/Dockerfile
touch tools/contracts-mcp/requirements.txt
```

### Step 2 — `requirements.txt`

```
fastmcp>=0.9.0
asyncpg>=0.29.0
starlette>=0.37.0
```

### Step 3 — `Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app

COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

COPY tools/contracts-mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Include the shared auth helpers
COPY tools/shared/ /app/tools/shared/
COPY tools/contracts-mcp/src/ ./src/

ENV PYTHONPATH=/app
CMD ["python", "-m", "src.server"]
```

### Step 4 — `src/server.py`

```python
"""
Contracts MCP Server.

Exposes one tool: get_contract_summary(client_name).
Enforces row-level security (assigned accounts only for rm role)
and column-level security (contract value masked for readonly).
"""
import json
import os
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg
from mcp.server.fastmcp import FastMCP

from platform_sdk import (
    MCPConfig,
    OpaClient,
    ToolResultCache,
    configure_logging,
    get_logger,
    setup_telemetry,
)
from platform_sdk.cache import make_cache_key
from tools.shared.mcp_auth import AgentContextMiddleware, get_agent_context

# ── Startup ────────────────────────────────────────────────────────────────────

configure_logging()
setup_telemetry(os.getenv("SERVICE_NAME", "contracts-mcp"))
log = get_logger(__name__)

_config = MCPConfig.from_env()
PORT    = int(os.environ.get("PORT", 8085))


# ── ServerContext (replaces module-level globals) ─────────────────────────────
# All MCP servers use a frozen dataclass + ContextVar so that lifespan
# resources are accessed without module globals and are easy to mock in tests.

from contextvars import ContextVar
from dataclasses import dataclass

@dataclass(frozen=True)
class ServerContext:
    config: MCPConfig
    db: asyncpg.Pool
    opa: OpaClient
    cache: Optional[ToolResultCache]

_ctx: ContextVar[ServerContext] = ContextVar("contracts_mcp_ctx")


@asynccontextmanager
async def _lifespan(server: FastMCP):
    db_pool = await asyncpg.create_pool(
        host     = os.environ["DB_HOST"],
        port     = int(os.environ.get("DB_PORT", 5432)),
        user     = os.environ["DB_USER"],
        password = os.environ["DB_PASS"],
        database = os.environ["DB_NAME"],
        min_size = 2,
        max_size = 10,
    )
    opa   = OpaClient(_config)
    cache = ToolResultCache.from_env(ttl_seconds=1800)
    _ctx.set(ServerContext(config=_config, db=db_pool, opa=opa, cache=cache))
    log.info("contracts_mcp_ready", port=PORT)
    yield
    if db_pool:
        await db_pool.close()


mcp = FastMCP(
    "contracts-mcp",
    lifespan     = _lifespan,
    host         = "0.0.0.0",
    port         = PORT,
    middleware   = [AgentContextMiddleware],   # populates ContextVar per request
)


# ── Tool implementation ────────────────────────────────────────────────────────

@mcp.tool()
async def get_contract_summary(client_name: str) -> str:
    """
    Retrieve active contract summary for a client.

    Args:
        client_name: The company name exactly as it appears in Salesforce.

    Returns:
        JSON object with contracts list, or an error string.
    """
    # 1. Read caller identity and server resources
    ctx = _ctx.get()           # ServerContext (db, opa, cache)
    agent_ctx = get_agent_context()  # AgentContext (role, clearance)
    log.info("contracts_tool_call", client_name=client_name, role=agent_ctx.role)

    # 2. Authorise the call via OPA
    allowed = await ctx.opa.authorize(
        "get_contract_summary",
        {
            "role":       agent_ctx.role,
            "rm_id":      agent_ctx.rm_id,
            "session_id": agent_ctx.session_id,
            "resource":   client_name,
        },
    )
    if not allowed:
        log.warning("contracts_unauthorized", client_name=client_name, role=agent_ctx.role)
        return json.dumps({"error": "Unauthorized — insufficient permissions for this tool."})

    # 3. Check the cache (key includes clearance level to isolate per-role results)
    col_mask_key = ":".join(sorted(agent_ctx.build_col_mask()))
    cache_key    = make_cache_key(
        "get_contract_summary",
        {"client_name": client_name, "col_mask_key": col_mask_key},
    )
    if ctx.cache:
        cached = await ctx.cache.get(cache_key)
        if cached:
            log.info("contracts_cache_hit", client_name=client_name)
            return cached

    # 4. Apply row-level security: rm role sees only assigned accounts
    row_filters = agent_ctx.build_row_filters_crm()
    assigned_ids = row_filters.get("Account") or []
    if agent_ctx.role == "rm" and not assigned_ids:
        return json.dumps({"no_data": True, "reason": "No accounts assigned to this RM."})

    # 5. Query with row filter and column masking
    try:
        result = await _query_contracts(ctx.db, client_name, assigned_ids, agent_ctx.build_col_mask())
    except asyncpg.PostgresError as exc:
        log.error("contracts_db_error", error=str(exc))
        return f"ERROR: Database error: {exc}"
    except Exception as exc:
        import traceback
        log.error("contracts_unexpected_error", error=str(exc),
                  tb=traceback.format_exc())
        return f"ERROR: Unexpected error: {exc}"

    # 6. Store in cache (never cache errors)
    output = json.dumps(result, default=str)
    if ctx.cache and not output.startswith('{"error"'):
        await ctx.cache.set(cache_key, output)

    return output


async def _query_contracts(
    db_pool: asyncpg.Pool,
    client_name: str,
    assigned_ids: list[str],
    col_mask: list[str],
) -> dict:
    """Run the actual SQL. Applies row and column security."""

    # Column masking: null out any masked column in the SELECT list
    contract_value_col = (
        "NULL::numeric AS \"ContractValue\""
        if "ContractValue" in col_mask
        else '"ContractValue"'
    )

    # Row filter: rm role gets a restricted account list; others see all
    if assigned_ids:
        account_filter = 'AND a."Id" = ANY($2::text[])'
        params = [client_name, assigned_ids]
    else:
        account_filter = ""
        params = [client_name]

    rows = await db_pool.fetch(
        f"""
        SELECT
            c."Id"            AS contract_id,
            c."ContractNumber" AS contract_number,
            c."Status"        AS status,
            c."StartDate"     AS start_date,
            c."EndDate"       AS end_date,
            {contract_value_col},
            c."Description"   AS description
        FROM salesforce."Contract" c
        JOIN salesforce."Account"  a ON a."Id" = c."AccountId"
        WHERE a."Name" ILIKE $1
          {account_filter}
          AND c."Status" IN ('Activated', 'Draft')
        ORDER BY c."EndDate" ASC
        LIMIT 20
        """,
        *params,
    )

    contracts = [dict(r) for r in rows]
    return {
        "client_name": client_name,
        "contract_count": len(contracts),
        "contracts": contracts,
    }


if __name__ == "__main__":
    mcp.run(transport=os.environ.get("MCP_TRANSPORT", "sse"))
```

### Step 5 — OPA policy

Add a rule to `tools/policies/opa/authz.rego`:

```rego
# get_contract_summary is available to all roles except readonly
allow_tool["get_contract_summary"] if {
    input.role != "readonly"
    input.session_id != ""
}
```

Add a unit test to `authz_test.rego`:

```rego
test_contracts_rm_allowed if {
    allow_tool["get_contract_summary"] with input as {
        "role": "rm", "rm_id": "rm-001",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "resource": "Microsoft Corp"
    }
}

test_contracts_readonly_denied if {
    not allow_tool["get_contract_summary"] with input as {
        "role": "readonly", "rm_id": "rm-999",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "resource": "Microsoft Corp"
    }
}
```

```bash
make test-policies   # must pass before the server can be deployed
```

### Step 6 — Register in `docker-compose.yml`

```yaml
  contracts-mcp:
    build:
      context: .
      dockerfile: tools/contracts-mcp/Dockerfile
    container_name: ai-contracts-mcp
    environment:
      MCP_TRANSPORT:   sse
      PORT:            "8085"
      SERVICE_NAME:    contracts-mcp
      ENVIRONMENT:     ${ENVIRONMENT:-local}
      DB_HOST:         pgvector
      DB_PORT:         "5432"
      DB_USER:         ${POSTGRES_USER:-postgres}
      DB_PASS:         ${POSTGRES_PASSWORD}
      DB_NAME:         ${POSTGRES_DB:-ai_platform}
      OPA_URL:         http://opa:8181
      REDIS_HOST:      redis
      REDIS_PORT:      "6379"
      REDIS_PASSWORD:  ${REDIS_PASSWORD}
      ENABLE_TOOL_CACHE: "true"
      TOOL_CACHE_TTL:  "1800"
      <<: *otel-env
    depends_on:
      pgvector: { condition: service_healthy }
      opa:      { condition: service_healthy }
      redis:    { condition: service_healthy }
    healthcheck:
      test: ["CMD", "python3", "-c",
             "import socket,sys; s=socket.socket(); r=s.connect_ex(('localhost',8085)); s.close(); sys.exit(0 if r==0 else 1)"]
      interval: 15s
      timeout:   5s
      retries:   5
    networks: [ai-network]
    ports:
      - "127.0.0.1:8085:8085"
```

### Step 7 — Write integration tests

Add `tests/integration/test_contracts_sql.py` covering:
- Column alias regression (same pattern as `test_payments_sql.py`)
- Row filter with `assigned_ids` returns only matching accounts
- Column masking returns `None` for `ContractValue` when clearance is `standard`
- Unknown client returns an empty list (not an error)

### Step 8 — Write eval fixtures

Add `tests/evals/fixtures/case_NNN_contracts_*.json` with:
- `crm_output`: mocked Salesforce data including contracts
- `payments_output`: mocked payments (or error if not relevant)
- `news_output`: mocked news
- `expected_rubric`: criteria like `cites_contract_value`, `flags_near_expiry`, `compliance_fields_not_mentioned`

---

### What the SDK handles automatically

| Concern | Code without SDK | Code with SDK |
|---|---|---|
| Configuration | 12+ `os.environ.get()` calls with defaults | `MCPConfig.from_env()` |
| OPA enforcement | ~40 lines: httpx, retry, timeout, fail-closed | `OpaClient(_config).authorize(tool, input)` |
| Redis caching | Connection pool, serialisation, TTL, error handling | `ToolResultCache.from_env(ttl=1800)` |
| Cache key generation | Hash function + argument serialisation | `make_cache_key("tool", {"param": val})` |
| Auth context | Header parsing, base64 decode, HMAC verify, ContextVar | `AgentContextMiddleware` + `get_agent_context()` |
| Row/column filters | Policy call + SQL construction | `ctx.build_row_filters_crm()`, `ctx.build_col_mask()` |
| Structured logging | `logging.getLogger()` + formatters | `get_logger(__name__)` with keyword args |
| OTel tracing | 20+ lines: TracerProvider, exporters, propagators | `setup_telemetry("service-name")` |

---

## 7. Component Reference

### Chat Agent (`agents/src/`)

Generic ReAct agent with tool-calling loop. Uses LangChain's `Tool` interface to dynamically call available MCP tools. Supports multi-turn conversation and conversational history trimming via context compaction.

### Salesforce MCP (`tools/salesforce-mcp/` :8081)

One tool: `get_salesforce_summary(client_name)`. Runs 7 queries: account profile, contacts, activities (Events UNION Tasks), open opportunities, open tasks, open cases, active contracts. Returns `account_id` — used by `payments-mcp` as the OPA resource identifier — and `account_name` — the exact string used as `dim_party.PartyName` in `bankdw`.

### Payments MCP (`tools/payments-mcp/` :8082)

One tool: `get_payment_summary(client_name)`. Runs 7 queries: outbound by rail, inbound by rail, prior-period trend, top counterparties, status mix, sending bank diversity, party compliance profile. Compliance profile fields are subject to column masking. `_DEFAULT_DAYS = 360` is hardcoded — the LLM never passes this parameter, eliminating a class of type errors.

### News MCP (`tools/news-search-mcp/` :8083)

One tool: `search_company_news(company_name)`. Uses Tavily Search API when `TAVILY_API_KEY` is set; falls back to deterministic mock data for the 4 seed companies. Derives an `aggregate_signal` label (RISK / OPPORTUNITY / POSITIVE / NEUTRAL / NO_NEWS).

### Data MCP (`tools/data-mcp/` :8080)

Generic secure SQL tool for the chat agent. Exposes `execute_read_query(sql, session_id)`. Enforces SELECT-only via OPA. Restricts queries to the workspace schema for the calling session.

### Shared Auth Helpers (`tools/shared/mcp_auth.py`)

`AgentContextMiddleware` — Starlette ASGI middleware. Reads and HMAC-verifies `X-Agent-Context`, populates a `ContextVar` per request. Tool handlers call `get_agent_context()` to retrieve the context without threading it through every function argument.

### MCPToolBridge (`agents/src/mcp_bridge.py`)

SSE client that connects to one MCP server and converts its tools to LangChain `StructuredTool` objects. Accepts an optional `agent_context` and forwards it as `X-Agent-Context` on the connection. The SSE connection lifecycle is owned by a dedicated `asyncio.Task` to avoid AnyIO cancel-scope errors in frameworks like Chainlit.

---

## 8. Environment Variables

All configuration is injected via environment variables. Run `cp .env.example .env` to start.

### Core secrets

| Variable | Purpose | Example |
|---|---|---|
| `INTERNAL_API_KEY` | Shared Bearer token — UI↔agent, agent↔LiteLLM | `sk-ent-abc123...` |
| `JWT_SECRET` | HMAC-SHA256 secret for RM JWTs | 64-char hex string |
| `AGENT_CONTEXT_SECRET` | HMAC secret for X-Agent-Context header signing | 64-char hex string |
| `POSTGRES_PASSWORD` | PostgreSQL admin password | strong random |
| `REDIS_PASSWORD` | Redis auth password | strong random |

### LLM routing

| Variable | Purpose | Default |
|---|---|---|
| `LITELLM_BASE_URL` | LiteLLM proxy URL | `http://litellm:4000/v1` |
| `AZURE_API_KEY` | Azure OpenAI key | — |
| `AZURE_API_BASE` | Azure OpenAI base URL | — |
| `AWS_ACCESS_KEY_ID` | For Bedrock fallback | — |
| `AWS_SECRET_ACCESS_KEY` | For Bedrock fallback | — |

### Agent services

| Variable | Purpose | Default |
|---|---|---|
| `AUTH_MODE` | `jwt` or `none` (dev bypass) | `jwt` |
| `SHOW_TEST_LOGIN` | Show persona selector in UI | `false` |
| `ENABLE_COMPACTION` | Context window trimming | `true` |
| `AGENT_CONTEXT_TOKEN_LIMIT` | Token budget before compaction | `8000` |
| `AGENT_RECURSION_LIMIT` | Max tool-call iterations | `15` |
| `SALESFORCE_MCP_URL` | Salesforce MCP SSE URL | — |
| `PAYMENTS_MCP_URL` | Payments MCP SSE URL | — |
| `NEWS_MCP_URL` | News MCP SSE URL | — |

### MCP servers

| Variable | Purpose | Default |
|---|---|---|
| `MCP_TRANSPORT` | `sse` or `stdio` | `sse` |
| `PORT` | Server listen port | per-service |
| `OPA_URL` | OPA decision endpoint | `http://opa:8181` |
| `ENVIRONMENT` | `local` or `prod` | `local` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASS` / `DB_NAME` | PostgreSQL connection | — |
| `REDIS_HOST` / `REDIS_PORT` | Redis | `redis` / `6379` |
| `ENABLE_TOOL_CACHE` | Enable Redis caching | `true` |
| `TOOL_CACHE_TTL` | Cache TTL in seconds | per-service |
| `TAVILY_API_KEY` | Live news search — omit for mock data | — |

### Checkpointer

| Variable | Purpose | Default |
|---|---|---|
| `CHECKPOINTER_TYPE` | `memory` or `postgres` | `memory` |
| `CHECKPOINTER_DB_URL` | PostgreSQL connection string for persistent checkpointing | — |

---

## 9. CI/CD Pipeline

The repo uses four GitHub Actions workflows in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci-unit.yml` | Push / PR to `main` | Runs `make test-unit` + `make test-policies` + `make lint` |
| `ci-integration.yml` | Push / PR to `main` | Builds Docker stack, seeds data, runs `make test-integration` |
| `ci-evals.yml` | Manual / scheduled | Runs LLM-in-the-loop evals against a deployed stack |
| `ci-deploy.yml` | Push to `main` (after merge) | Builds images, pushes to ECR, deploys to ECS |

The recommended contribution workflow is: create a feature branch, open a PR, confirm `ci-unit` and `ci-integration` pass, request review. Evals run on-demand for changes that affect LLM prompts or synthesis logic.

---

## 10. Data Flows

### Generic Chat Request

```
Client → POST /chat (Bearer INTERNAL_API_KEY)
  → make_api_key_verifier() validates → 401 if invalid
  → LangGraph ReAct loop starts
  → LiteLLM checks Redis semantic cache → hit: return cached LLM response
  → LLM reasons, decides to call a tool
  → MCPToolBridge sends call to data-mcp over SSE
  → data-mcp: OpaClient.authorize() → fail-closed if OPA unreachable
  → data-mcp: ToolResultCache.get() → hit: return cached result
  → data-mcp: asyncpg SELECT in workspace schema
  → data-mcp: ToolResultCache.set()
  → Tool result → LangGraph → LLM incorporates it or calls another tool
  → Final answer → {"content": "...", "session_id": "..."}
```

Every step emits an OTel span. Full trace visible in your OTel backend (LangFuse at http://localhost:3001, or any OTLP-compatible backend) with per-hop latency for agent → LiteLLM → MCP → OPA → DB.

### Agent Request Flow

```
User → POST /chat (Bearer INTERNAL_API_KEY + jwt_token in body)
  → AgentContext.from_jwt(jwt_token) — verified once at boundary
  → ReAct loop: classify intent → select tool → call MCP
  → MCPToolBridge → available MCP servers (data-mcp, salesforce-mcp, payments-mcp, news-mcp)
       → AgentContextMiddleware reads X-Agent-Context
       → OPA: allow? + row_filters (assigned accounts) + col_mask (sensitive columns)
       → PostgreSQL: WHERE filters apply + column masking if restricted clearance
  → LLM synthesizes response from MCP tool results
  → {"message": "...", "session_id": "..."}
```

Standard user sees only permitted accounts and no restricted fields. Compliance user sees all accounts and all fields. Same code path — OPA and AgentContext decide the difference.
