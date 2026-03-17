# Developer Guide — Enterprise AI Platform

This guide explains the architecture, the role of every component, and how to build new agents and MCP servers using the shared SDK. Read the System Overview and Platform SDK sections before starting any new service.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Platform SDK — Separation of Concerns](#2-platform-sdk--separation-of-concerns)
3. [Component Reference](#3-component-reference)
4. [Authorization Chain — JWT → AgentContext → OPA → PostgreSQL](#4-authorization-chain--jwt--agentcontext--opa--postgresql)
5. [Test Data Architecture](#5-test-data-architecture)
6. [Step-by-Step: Building a New Agent](#6-step-by-step-building-a-new-agent)
7. [Step-by-Step: Building a New MCP Server](#7-step-by-step-building-a-new-mcp-server)
8. [Environment Variables](#8-environment-variables)
9. [Data Flow: Generic Chat Request](#9-data-flow-generic-chat-request)
10. [Data Flow: RM Prep Brief Request](#10-data-flow-rm-prep-brief-request)

---

## 1. System Overview

This platform hosts two independently deployable agents:

**Generic Chat Agent** — a LangGraph ReAct loop connected to a secure read-only SQL tool (`data-mcp`). It serves the Chainlit `chat-ui` and a REST `/chat` endpoint.

**RM Prep Agent** — a LangGraph `StateGraph` orchestrator that prepares relationship manager client briefs. It fans out to three specialist MCP servers in parallel (Salesforce CRM, bank payments, news), synthesises the results with a larger model, and returns structured Markdown.

```
  ┌─────────────────────────┐        ┌───────────────────────────────────┐
  │  Chainlit Chat UI :8501  │        │  Streamlit RM Prep UI :8502       │
  └────────────┬────────────┘        └──────────────┬────────────────────┘
               │ API key (Bearer)                    │ JWT (Bearer)
               ▼                                     ▼
  ┌────────────────────────┐        ┌────────────────────────────────────┐
  │  Agent Service  :8000  │        │  RM Prep Agent  :8003              │
  │  ReAct loop            │        │  StateGraph orchestrator           │
  │  · data-mcp  :8080     │        │  · salesforce-mcp  :8081           │
  │    (SQL tool)          │        │  · payments-mcp    :8082           │
  └────────┬───────────────┘        │  · news-search-mcp :8083           │
           │                        └──────────┬──────────┬──────────────┘
           │                                   │          │
           └──────────────────────────┬────────┘          │
                                      ▼                    ▼
                           ┌──────────────────┐  ┌──────────────────┐
                           │  PostgreSQL :5432 │  │  OPA  :8181      │
                           │  · agent memory   │  │  · tool_auth     │
                           │  · salesforce.*   │  │  · rm_prep_authz │
                           │  · bankdw.*       │  └──────────────────┘
                           └──────────────────┘
                    ┌────────────────────────────────┐
                    │  Shared infra (one container each)│
                    │  LiteLLM :4000  Redis  OTel :4318 │
                    └────────────────────────────────┘
```

All services run on one Docker bridge network (`ai-network`). Containers reach each other by service name — no hardcoded IPs.

---

## 2. Platform SDK — Separation of Concerns

### Why a shared SDK?

Without a shared SDK every new service independently implements authentication, OPA integration, Redis caching, context compaction, structured logging, and OpenTelemetry tracing — duplicated code, inconsistent behaviour, bugs fixed in one place but not others.

The `platform-sdk` moves these **cross-cutting concerns** into one tested, versioned package. A new service imports and calls; it never re-implements.

### The SDK modules

```
platform-sdk/platform_sdk/
│
├── auth.py          ← "Who is calling, and what are they allowed to see?"
├── config.py        ← "What does this service need to know?"
├── security.py      ← "Is this request allowed?"
├── cache.py         ← "Have we seen this before?"
├── compaction.py    ← "Is the context window getting too full?"
├── agent.py         ← "Build me a LangGraph agent or specialist node"
│
├── logging.py       ← "Write structured JSON logs"
├── telemetry.py     ← "Emit OpenTelemetry traces"
└── llm_client.py    ← "Call the LLM directly (no agent loop)"
```

---

### `auth.py` — AgentContext

**The problem:** The RM Prep agent needs to enforce row-level security (which accounts an RM can see) and column-level security (which compliance fields are visible) across three different MCP servers. Passing raw JWT tokens through every layer is insecure; re-verifying the JWT in each MCP server adds crypto overhead and couples all servers to the auth secret.

**The solution:** `AgentContext` — a frozen dataclass that carries verified identity and permission claims for one RM session. The orchestrator verifies the JWT once and serialises the context as base64-JSON in `X-Agent-Context`. Each MCP server reads and deserialises the header (no JWT re-verification needed) and uses the context to build OPA row/col filters before querying PostgreSQL.

```python
from platform_sdk import AgentContext

# At the API boundary (RM Prep agent server.py):
ctx = AgentContext.from_jwt(request.headers["Authorization"].removeprefix("Bearer "))

# Forward to every MCP bridge:
bridge = MCPToolBridge(sf_url, agent_context=ctx)

# In an MCP server tool handler (tools/shared/mcp_auth.py):
ctx = get_agent_context()          # reads ContextVar set by AgentContextMiddleware
row_filter = ctx.build_row_filters_crm()   # {"Account": ["001AAA", "002AAA"]} for rm role
col_mask   = ctx.build_col_mask()          # ["AMLRiskCategory", ...] for standard clearance

if not ctx.can_access_account(resolved_account_id):
    return json.dumps({"error": "access_denied"})
```

The `AgentContext.anonymous()` class method provides a fully-cleared dev context when `AUTH_MODE=none` in local development.

---

### `config.py` — Typed configuration

Two typed dataclasses — `AgentConfig` for agent services and `MCPConfig` for MCP servers — each with a `from_env()` classmethod that reads all environment variables once, validates them, and applies bounds-checked defaults.

```python
from platform_sdk import AgentConfig, MCPConfig

config = AgentConfig.from_env()
# config.model_route, config.recursion_limit, config.enable_compaction ...

config = MCPConfig.from_env()
# config.opa_url, config.opa_timeout_seconds, config.max_result_bytes ...
```

---

### `security.py` — OPA client and API key verification

`OpaClient` — async OPA decision client with retry, timeout, and fail-closed handling:

```python
from platform_sdk import OpaClient, MCPConfig

opa = OpaClient(MCPConfig.from_env())
allowed = await opa.authorize("my_tool_name", {"query": q, "session_id": sid})
if not allowed:
    return "ERROR: Unauthorized."
```

`make_api_key_verifier()` — FastAPI dependency for `Authorization: Bearer <key>`:

```python
from platform_sdk import make_api_key_verifier
verify_api_key = make_api_key_verifier()

@app.post("/chat")
async def chat(body: ChatRequest, _: str = Depends(verify_api_key)):
    ...
```

Both are **fail-closed**: OPA unreachable → deny; `INTERNAL_API_KEY` not set → all requests rejected.

---

### `cache.py` — Tool-result caching

`ToolResultCache` stores results in Redis keyed by `sha256(tool_name + args)`. Degrades gracefully when Redis is unavailable.

```python
# Preferred pattern — explicit cache check inside the tool handler
from platform_sdk import ToolResultCache
from platform_sdk.cache import make_cache_key

_cache = ToolResultCache.from_env(ttl_seconds=1800)

@mcp.tool()
async def my_tool(client_name: str) -> str:
    if _cache:
        key = make_cache_key("my_tool", {"client_name": client_name})
        cached = await _cache.get(key)
        if cached:
            return cached

    result = await _do_work(client_name)

    if _cache and not result.startswith('{"error"'):
        await _cache.set(key, result)

    return result
```

---

### `compaction.py` — Context window trimming

`make_compaction_modifier(config)` returns a LangGraph `state_modifier` that trims the oldest messages when the token count exceeds `config.context_token_limit`, always preserving the system message.

```python
from platform_sdk.compaction import make_compaction_modifier
modifier = make_compaction_modifier(config)
# Passed to build_agent() — you rarely need this directly.
```

---

### `agent.py` — LangGraph agent factories

Two factories:

`build_agent(tools, config, prompt)` — ReAct agent for the generic chat service:

```python
from platform_sdk import AgentConfig, build_agent
config = AgentConfig.from_env()
agent  = build_agent(tools, config=config, prompt=system_prompt)
result = await agent.ainvoke({"messages": [HumanMessage(content=msg)]}, ...)
```

`build_specialist_agent(tools, config, prompt, model_override)` — single-tool-call node for the RM Prep pipeline (Haiku by default, callers can override):

```python
from platform_sdk import build_specialist_agent
crm_agent = build_specialist_agent(sf_tools, config, crm_prompt, model_override=config.specialist_model_route)
result = await crm_agent.ainvoke({"messages": [HumanMessage(content=f"Client: {name}")]})
```

---

### `logging.py` and `telemetry.py` — Observability

```python
from platform_sdk import configure_logging, get_logger, setup_telemetry

configure_logging()
setup_telemetry("my-service-name")
log = get_logger(__name__)

log.info("event_name", client=name, duration_ms=42)
# → {"event": "event_name", "client": "...", "duration_ms": 42, "timestamp": "..."}
```

---

## 3. Component Reference

### Generic Agent Service
**Location:** `agents/src/`

FastAPI + LangGraph ReAct agent. Connects to `data-mcp` at startup via the `MCPToolBridge`. The bridge converts MCP tool schemas (JSON Schema) into typed LangChain `StructuredTool` objects. Bearer auth via `make_api_key_verifier()`. SSE connection lifecycle owned by a background `asyncio.Task` to avoid AnyIO cancel-scope cross-task errors.

### RM Prep Agent
**Location:** `agents/rm-prep/src/`

A LangGraph `StateGraph` (not a ReAct loop). Stages:

1. **parse_intent** — Haiku structured extraction: client name, intent type, meeting date
2. **route** — Python dict lookup: maps intent to which agents to invoke (`full_brief` → all three)
3. **gather_crm / gather_payments / gather_news** — parallel specialist nodes, each backed by a dedicated MCP server
4. **synthesize** — Sonnet structured output into `RMBrief` Pydantic model
5. **format_brief** — Jinja2 render to Markdown

Model tiering is intentional: fast/cheap Haiku for extraction and tool calls; Sonnet only for the synthesis step that requires coherent writing.

### Salesforce MCP (`salesforce-mcp` :8081)
**Location:** `tools/salesforce-mcp/src/server.py`

Queries the `salesforce.*` PostgreSQL schema (mirroring standard Salesforce object names). One tool: `get_salesforce_summary(client_name)`. Makes 7 queries per call: account lookup, contacts, activities (Events UNION Tasks), open opportunities, open tasks, open service cases, active contracts. Returns a flat JSON object including `account_id` (used by the payments tool as a join key) and `account_name` (the exact string used in `bankdw` as the party name).

Cache TTL: 1800s.

### Payments MCP (`payments-mcp` :8082)
**Location:** `tools/payments-mcp/src/server.py`

Queries `bankdw.fact_payments` and `bankdw.dim_party` using `client_name` (= `Account.Name` = `dim_party.PartyName`) as the join key. One tool: `get_payment_summary(client_name, days=90)`. Makes 7 queries: outbound by rail, inbound by rail, prior-period trend, top counterparties, status mix, sending bank diversity, party compliance profile. The compliance profile fields (`AMLRiskCategory`, `SanctionsScreeningStatus`, etc.) are subject to column-level masking by the `AgentContextMiddleware`.

Cache TTL: 3600s.

### News Search MCP (`news-search-mcp` :8083)
**Location:** `tools/news-search-mcp/src/server.py`

One tool: `search_company_news(company_name)`. Uses Tavily Search API when `TAVILY_API_KEY` is set; falls back to deterministic mock data for the 4 seed companies in development. Derives an `aggregate_signal` label (RISK / OPPORTUNITY / POSITIVE / NEUTRAL / NO_NEWS) from article sentiment and signal types.

Cache TTL: 1800s.

### Shared Auth Helpers (`tools/shared/mcp_auth.py`)

`AgentContextMiddleware` — Starlette ASGI middleware. Reads `X-Agent-Context` header, base64-decodes it, stores in a `ContextVar`. Tool handlers call `get_agent_context()` to retrieve the per-request context without passing it through every function argument.

Policy helpers: `can_access_account()`, `build_row_filters_crm()`, `build_row_filters_payments()`, `build_col_mask()`, `check_access()`.

### MCPToolBridge (`agents/src/mcp_bridge.py`)
SSE client that connects to one MCP server and converts all its tools to LangChain `StructuredTool` objects. Accepts optional `agent_context` and forwards it as `X-Agent-Context` on the connection. The SSE connection lifecycle is owned by a dedicated `asyncio.Task` to avoid AnyIO cancel-scope errors in frameworks like Chainlit where request start and end run in different tasks.

### OPA Policies (`tools/policies/opa/`)

**`tool_auth.rego`** — data-mcp policy. Checks session UUID, query type (SELECT-only), and agent role. Package `mcp.tools`.

**`rm_prep_authz.rego`** — RM Prep policy. Package `rm_prep.authz`. Role hierarchy (readonly=0 … compliance_officer=3). Outputs `result` object:
- `allow` — boolean
- `reason` — human-readable denial reason
- `row_filters` — `{"Account": [...account_ids...]}` for `rm` role; `{}` for elevated roles
- `col_mask` — list of column names to redact (AML columns for standard; all compliance columns for aml_view; empty for compliance_full)

### LiteLLM
**Location:** `platform/config/litellm-local.yaml`, `litellm-prod.yaml`

Multi-cloud LLM proxy. Routes `complex-routing` → Azure GPT-4o (synthesis), `fast-routing` → Azure GPT-4o-mini (extraction/tool calls). The RM Prep agent uses both routes. LiteLLM handles failover (Azure → Bedrock in prod) and Redis prompt caching. The `master_key` must match `INTERNAL_API_KEY`.

---

## 4. Authorization Chain — JWT → AgentContext → OPA → PostgreSQL

```
 RM Prep UI
     │  Authorization: Bearer <JWT>
     ▼
 rm-prep-agent/src/server.py
     │  AgentContext.from_jwt(token)
     │  Raises jwt.InvalidSignatureError on tampered tokens
     │  Raises jwt.ExpiredSignatureError on expired tokens
     ▼
 AgentContext(
   rm_id="rm-001", role="rm", team_id="treasury-west",
   assigned_account_ids=("001AAA","002AAA"),
   compliance_clearance=("standard",)
 )
     │  MCPToolBridge(sf_url, agent_context=ctx)
     │  → SSE connection header: X-Agent-Context: <base64-JSON>
     ▼
 salesforce-mcp / payments-mcp
     │  AgentContextMiddleware reads header → ContextVar
     │  get_agent_context() in tool handler
     ▼
 OPA rm_prep_authz.rego
     │  input = {rm_id, role, assigned_account_ids, clearance, tool, resource}
     │  → result.allow, result.row_filters, result.col_mask
     ▼
 PostgreSQL
     │  WHERE "AccountId" = ANY($assigned_account_ids)   ← row filter
     │  NULL-out AMLRiskCategory, RiskRating, ...         ← col mask
     ▼
 JSON response (masked fields absent or null)
```

**Role matrix:**

| Role | Accounts visible | AML columns | Sanctions/PEP columns |
|---|---|---|---|
| `readonly` | none (tool denied) | — | — |
| `rm` | assigned only | masked | masked |
| `senior_rm` | all | visible | masked |
| `manager` | all | visible | masked |
| `compliance_officer` | all | visible | visible |

**Test JWT personas** (generated by `tests/fixtures/test_tokens.py`):

| Persona | Role | Accounts | Clearance |
|---|---|---|---|
| `alice_rm` | rm | 4 assigned | standard |
| `eve_rm_single` | rm | 1 assigned | standard |
| `frank_rm_empty` | rm | 0 (all denied) | standard |
| `bob_senior_rm` | senior_rm | all | standard + aml_view |
| `carol_manager` | manager | all | standard + aml_view |
| `dan_compliance` | compliance_officer | all | standard + aml_view + compliance_full |
| `grace_readonly` | readonly | none | standard |

```bash
# Generate tokens for manual testing:
python tests/fixtures/test_tokens.py

# Use alice_rm token against the RM Prep API:
TOKEN=$(python -c "from tests.fixtures.test_tokens import get_token; print(get_token('alice_rm'))")
curl -X POST http://localhost:8003/brief \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Prepare a brief for Microsoft Corp."}'
```

---

## 5. Test Data Architecture

### Why PostgreSQL for both test and prod?

Using the same PostgreSQL engine in test eliminates the main source of test-vs-prod divergence: SQL dialect differences, type handling, and query planner behaviour. No adapter abstraction layer, no code switches, no `if test: use_duckdb() else: use_postgres()`.

### How the overlay works

`docker-compose.test.yml` adds volume mounts to the existing `pgvector` service. PostgreSQL's Docker image runs all files in `/docker-entrypoint-initdb.d/` alphabetically on the **first start of a fresh volume**:

```
01-init.sql               → base extensions, roles
02-rm_prep_schema.sql     → rm_prep tables (public schema)
03-rm_prep_seed.sql       → rm_prep seed data
20_test_sfcrm_schema.sql  → CREATE SCHEMA salesforce + 15 tables
21_test_sfcrm_seed.sql    → COPY FROM /testdata/sfcrm/*.csv
30_test_bankdw_schema.sql → CREATE SCHEMA bankdw + 5 tables
31_test_bankdw_seed.sql   → COPY FROM /testdata/bankdw/*.csv
```

**Key:** scripts only run on a brand-new volume. If a volume already exists from a previous `docker compose up`, PostgreSQL silently skips init. Run `make dev-reset` (which does `down -v` then `up --build`) after any schema change.

### Schema cross-domain identity spine

All 45 Salesforce accounts in `sfcrm/Account.csv` have a 1:1 match in `bankdw/dim_party.csv` by `Name` = `PartyName`. This is the join key that allows `payments-mcp` to look up payment data by the company name retrieved from Salesforce. The `payments-mcp` tool signature uses `client_name` (not `client_id`) for this reason.

### testdata contents

| File | Rows | Purpose |
|---|---|---|
| `sfcrm/Account.csv` | 45 | Fortune 500 companies — all major industries |
| `sfcrm/Contact.csv` | ~180 | 4 contacts per account |
| `sfcrm/Opportunity.csv` | ~135 | 3 open opps per account |
| `sfcrm/Task.csv` | ~225 | 5 tasks per account |
| `sfcrm/Event.csv` | ~90 | 2 events per account |
| `sfcrm/Case.csv` | ~90 | 2 cases per account |
| `sfcrm/Contract.csv` | ~45 | 1 contract per account |
| `bankdw/fact_payments.csv` | 1000 | Synthetic payment transactions |
| `bankdw/dim_party.csv` | 45 | Same 45 companies with compliance profiles |
| `bankdw/dim_bank.csv` | 8 | Realistic US banks |
| `bankdw/dim_product.csv` | 4 | ACH, Wire, RTP, SWIFT |
| `bankdw/bridge_party_account.csv` | 2000 | Account-to-bank relationships |

Compliance profiles are deliberately varied to cover authorization test paths: some accounts are KYC:Pending, some AML:High, some PEP-flagged — ensuring tests exercise masking logic at all clearance levels.

---

## 6. Step-by-Step: Building a New Agent

This walkthrough builds a **Document Analysis Agent** — a ReAct agent that reads documents from a hypothetical `docs-mcp` server. The pattern is identical for any other single-domain ReAct agent.

### Step 1 — Create the project structure

```bash
mkdir -p agents-docanalysis/src/prompts
touch agents-docanalysis/src/{__init__,server,graph}.py
touch agents-docanalysis/Dockerfile agents-docanalysis/requirements.txt
```

### Step 2 — Write `requirements.txt`

```
fastapi>=0.111.0
uvicorn[standard]>=0.30.0
langchain-core>=0.2.0
langchain-openai>=0.1.8
langgraph>=0.2.0
httpx>=0.27.0
```

The `platform-sdk` is **not** listed here — it is installed via `Dockerfile` from the monorepo root.

### Step 3 — Write the Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/
COPY agents-docanalysis/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agents-docanalysis/src/ ./src/
CMD ["uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "8001"]
```

### Step 4 — Write `graph.py`

```python
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from platform_sdk import AgentConfig, build_agent

_jinja_env = Environment(loader=FileSystemLoader(str(Path(__file__).parent / "prompts")), autoescape=False)

def build_doc_agent(tools: list):
    config = AgentConfig.from_env()
    prompt = _jinja_env.get_template("doc_agent.j2").render(tool_names=[t.name for t in tools])
    return build_agent(tools, config=config, prompt=prompt)
```

### Step 5 — Write `server.py`

```python
import os
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException, Request
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field
from platform_sdk import AgentConfig, configure_logging, get_logger, make_api_key_verifier, setup_telemetry
from .mcp_bridge import MCPToolBridge
from .graph import build_doc_agent

configure_logging()
setup_telemetry(os.getenv("SERVICE_NAME", "doc-analysis-agent"))
log = get_logger(__name__)

_config = AgentConfig.from_env()
verify_api_key = make_api_key_verifier()

@asynccontextmanager
async def lifespan(app: FastAPI):
    bridge = MCPToolBridge(os.environ["DOCS_MCP_SSE_URL"])
    await bridge.connect()
    tools = await bridge.get_langchain_tools()
    app.state.agent = build_doc_agent(tools)
    app.state.bridge = bridge
    yield
    await bridge.disconnect()

app = FastAPI(lifespan=lifespan)

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=_config.max_message_length)
    session_id: str = "default"

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/chat")
async def chat(body: ChatRequest, req: Request, _: str = Depends(verify_api_key)):
    try:
        result = await req.app.state.agent.ainvoke(
            {"messages": [HumanMessage(content=body.message)]},
            config={"recursion_limit": _config.recursion_limit, "configurable": {"thread_id": body.session_id}},
        )
        return {"content": result["messages"][-1].content, "session_id": body.session_id}
    except Exception as exc:
        log.error("chat_error", error=str(exc))
        raise HTTPException(status_code=500, detail="Internal error")
```

### Step 6 — Register in `docker-compose.yml`

```yaml
  doc-analysis-agent:
    build:
      context: .
      dockerfile: agents-docanalysis/Dockerfile
    container_name: ai-doc-agent
    environment:
      LITELLM_BASE_URL: http://litellm:4000/v1
      DOCS_MCP_SSE_URL: http://docs-mcp:8082/sse
      INTERNAL_API_KEY: ${INTERNAL_API_KEY}
      SERVICE_NAME: doc-analysis-agent
      ENABLE_COMPACTION: "true"
      <<: *otel-env
    depends_on:
      litellm:
        condition: service_healthy
      docs-mcp:
        condition: service_healthy
    networks:
      - ai-network
    ports:
      - "127.0.0.1:8001:8001"
```

---

## 7. Step-by-Step: Building a New MCP Server

This walkthrough builds a **Web Search MCP Server**. The pattern applies to any external API.

### Step 1 — Create the project structure

```bash
mkdir -p tools/search-mcp/src
touch tools/search-mcp/src/{__init__,server}.py
touch tools/search-mcp/Dockerfile tools/search-mcp/requirements.txt
```

### Step 2 — Write `server.py`

```python
import json, os
from contextlib import asynccontextmanager
from typing import Optional
import httpx
from mcp.server.fastmcp import FastMCP
from platform_sdk import MCPConfig, ToolResultCache, configure_logging, get_logger
from platform_sdk.cache import make_cache_key

configure_logging()
log = get_logger(__name__)

_config = MCPConfig.from_env()
_cache: Optional[ToolResultCache] = None
_http:  Optional[httpx.AsyncClient] = None

TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")
PORT = int(os.environ.get("PORT", 8084))

@asynccontextmanager
async def _lifespan(server: FastMCP):
    global _cache, _http
    _cache = ToolResultCache.from_env(ttl_seconds=60)
    _http  = httpx.AsyncClient(
        base_url=os.environ.get("SEARCH_API_URL", ""),
        headers={"Authorization": f"Bearer {os.environ.get('SEARCH_API_KEY', '')}"},
        timeout=10.0,
    )
    log.info("search_mcp_ready")
    yield
    await _http.aclose()

mcp = FastMCP("search-mcp", lifespan=_lifespan, host="0.0.0.0", port=PORT)

@mcp.tool()
async def web_search(query: str, max_results: int = 5) -> str:
    """
    Search the web and return top results as JSON.

    Args:
        query:       The search query.
        max_results: Number of results (1–10).
    Returns:
        JSON string with articles list, or error JSON.
    """
    if _cache:
        key = make_cache_key("web_search", {"query": query, "max_results": max_results})
        cached = await _cache.get(key)
        if cached:
            return cached

    log.info("web_search_call", query=query)
    try:
        resp = await _http.get("", params={"q": query, "count": min(max_results, 10)})
        resp.raise_for_status()
        results = resp.json().get("results", [])
        output = json.dumps(results, default=str)
    except Exception as exc:
        log.error("web_search_error", error=str(exc))
        return json.dumps({"error": str(exc)})

    if _cache and not output.startswith('{"error"'):
        await _cache.set(key, output)
    return output

if __name__ == "__main__":
    mcp.run(transport=TRANSPORT)
```

### Step 3 — Add an OPA allow rule

Add to `tools/policies/opa/tool_auth.rego`:

```rego
allow if {
    input.tool == "web_search"
    allowed_roles[input.agent_role]
    input.session_id != ""
}
```

Add a unit test to `tool_auth_test.rego`:

```rego
test_web_search_allowed if {
    allow with input as {
        "tool": "web_search", "agent_role": "data_analyst_agent",
        "session_id": "123e4567-e89b-12d3-a456-426614174000", "query": "AI trends"
    }
}
```

Run: `make test-policies`

### Step 4 — Register in `docker-compose.yml`

```yaml
  search-mcp:
    build:
      context: .
      dockerfile: tools/search-mcp/Dockerfile
    container_name: ai-search-mcp
    environment:
      MCP_TRANSPORT: sse
      SEARCH_API_KEY: ${SEARCH_API_KEY}
      SEARCH_API_URL: ${SEARCH_API_URL}
      SERVICE_NAME: search-mcp
      ENVIRONMENT: ${ENVIRONMENT:-local}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      ENABLE_TOOL_CACHE: "true"
      <<: *otel-env
    depends_on:
      redis:
        condition: service_healthy
      opa:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python3", "-c",
             "import socket,sys; s=socket.socket(); r=s.connect_ex(('localhost',8084)); s.close(); sys.exit(0 if r==0 else 1)"]
      interval: 15s
      timeout: 5s
      retries: 5
    networks:
      - ai-network
    ports:
      - "127.0.0.1:8084:8084"
```

### What the SDK handles for you

| Concern | Without SDK | With SDK |
|---|---|---|
| Configuration | 10+ `os.environ.get()` calls | `MCPConfig.from_env()` — one call, fully typed |
| OPA enforcement | ~40 lines: httpx, retry, timeout, fail-closed | `OpaClient(_config).authorize(tool, input)` |
| Caching | Redis connection, key gen, error handling, TTL | `ToolResultCache.from_env()` + `make_cache_key()` |
| Auth context | Header parsing, base64 decode, ContextVar management | `AgentContextMiddleware` + `get_agent_context()` |
| Structured logging | Standard `logging` with no keyword arg support | `get_logger(__name__)` — JSON, keyword args |
| Tracing | 15+ lines of OTel setup + idempotency guard | `setup_telemetry("service-name")` |

---

## 8. Environment Variables

All configuration is injected via environment variables. Never hardcode values. See `.env.example` for the full list with descriptions.

### Shared / infra

| Variable | Purpose |
|---|---|
| `INTERNAL_API_KEY` | Shared Bearer token — agent↔LiteLLM, client↔agent, UI↔agent |
| `POSTGRES_PASSWORD` | PostgreSQL admin password |
| `REDIS_PASSWORD` | Redis auth password |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector OTLP HTTP endpoint |

### RM Prep auth

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | HMAC-SHA256 secret for signing/verifying RM JWTs |
| `AUTH_MODE` | `jwt` (enforce JWT) or `none` (dev bypass — uses anonymous context) |
| `SHOW_TEST_LOGIN` | `true` → show persona selector in rm-prep-ui |

### Agent services

| Variable | Purpose |
|---|---|
| `LITELLM_BASE_URL` | LiteLLM proxy URL (default `http://litellm:4000/v1`) |
| `AGENT_MODEL_ROUTE` | LiteLLM route for main agent calls |
| `ENABLE_COMPACTION` | `true`/`false` — context window trimming |
| `AGENT_CONTEXT_TOKEN_LIMIT` | Token budget before compaction fires |
| `AGENT_RECURSION_LIMIT` | Max tool-call iterations (1–50) |
| `SALESFORCE_MCP_URL` | Salesforce MCP SSE URL (RM Prep agent) |
| `PAYMENTS_MCP_URL` | Payments MCP SSE URL (RM Prep agent) |
| `NEWS_MCP_URL` | News MCP SSE URL (RM Prep agent) |

### MCP servers

| Variable | Purpose |
|---|---|
| `MCP_TRANSPORT` | `sse` (default) or `stdio` |
| `PORT` | Server port (8080 data-mcp, 8081 SF, 8082 payments, 8083 news) |
| `OPA_URL` | OPA decision endpoint |
| `ENVIRONMENT` | `local`/`prod` — stamped into OPA input |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASS` / `DB_NAME` | PostgreSQL connection |
| `REDIS_HOST` / `REDIS_PORT` | Redis for tool result cache |
| `ENABLE_TOOL_CACHE` | `true`/`false` |
| `TOOL_CACHE_TTL` | Cache TTL in seconds |
| `TAVILY_API_KEY` | News search API key — omit to use mock data in dev |

---

## 9. Data Flow: Generic Chat Request

1. Client sends `POST /chat` with `Authorization: Bearer <INTERNAL_API_KEY>`.
2. `make_api_key_verifier()` validates — 401 if invalid.
3. LangGraph ReAct loop starts. LLM reasons via LiteLLM → Azure OpenAI.
4. LiteLLM checks Redis prompt cache — returns cached response on hit (no Azure round-trip).
5. `make_compaction_modifier` trims message list if token count exceeds budget.
6. LLM calls a tool → MCP bridge sends call to `data-mcp` over open SSE connection.
7. `OpaClient.authorize()` checks OPA — fail-closed if OPA is unreachable.
8. `ToolResultCache.get()` checks Redis — returns cached result on hit.
9. Cache miss: `data-mcp` runs SELECT via asyncpg in the workspace schema.
10. `ToolResultCache.set()` stores result in Redis.
11. Tool result returned to LangGraph; LLM incorporates it or calls another tool.
12. Final answer returned as `{"content": "...", "session_id": "..."}`.

Every step emits an OTel span — full trace in Dynatrace with agent→LiteLLM→MCP→OPA→DB latency per hop.

---

## 10. Data Flow: RM Prep Brief Request

1. RM logs into Streamlit UI (`rm-prep-ui`) — picks persona in test mode or logs in with credentials.
2. UI signs a JWT and sends `POST /brief` with `Authorization: Bearer <JWT>`.
3. RM Prep agent verifies JWT → creates `AgentContext(role, assigned_account_ids, compliance_clearance)`.
4. **parse_intent** node (Haiku): extracts `client_name`, `intent_type`, `meeting_date`.
5. **route** node: maps intent to which agents to invoke — `full_brief` → all three.
6. **gather_crm**, **gather_payments**, **gather_news** execute in parallel (LangGraph fan-out):
   - Each specialist node invokes its MCP server via a `MCPToolBridge` carrying the `AgentContext`.
   - MCP server middleware reads `X-Agent-Context`, populates ContextVar.
   - Tool handler calls `check_access()` and `build_row_filters_*()` / `build_col_mask()`.
   - OPA returns `allow`, `row_filters`, `col_mask` for the caller's role.
   - PostgreSQL query runs with account ID filter; AML/compliance columns nulled out if not cleared.
   - Result JSON returned to specialist node.
7. **synthesize** node (Sonnet): receives CRM + payments + news JSON, outputs structured `RMBrief`.
8. **format_brief** node: Jinja2-renders `RMBrief` to Markdown.
9. Response returned to Streamlit UI; brief displayed with collapsible source sections.

Standard RM (`alice_rm`) sees only her 4 assigned accounts and no AML/compliance fields. Compliance officer (`dan_compliance`) sees all accounts and all fields — same code path, different OPA decision.
