# Developer Guide — Enterprise AI Platform

This guide explains the architecture, the role of every component, and how to build new agents and MCP servers using the shared SDK. Read the System Overview and Platform SDK sections before starting any new service.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Platform SDK — Separation of Concerns](#2-platform-sdk--separation-of-concerns)
3. [Component Reference](#3-component-reference)
4. [Step-by-Step: Building a New Agent](#4-step-by-step-building-a-new-agent)
5. [Step-by-Step: Building a New MCP Server](#5-step-by-step-building-a-new-mcp-server)
6. [Environment Variables](#6-environment-variables)
7. [Data Flow: A Single Chat Request](#7-data-flow-a-single-chat-request)

---

## 1. System Overview

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
                    │  · Bearer auth  ──────── SDK  │
                    │  · AgentConfig  ──────── SDK  │
                    │  · build_agent  ──────── SDK  │
                    └──────┬───────────────┬────────┘
                           │ LLM calls     │ MCP tool calls (SSE)
                           ▼               ▼
            ┌──────────────────┐  ┌────────────────────────┐
            │  LiteLLM  :4000  │  │  Data MCP Server :8080 │
            │  Azure OpenAI    │  │  tools/data-mcp/       │
            │  AWS Bedrock     │  │  · OpaClient  ─── SDK  │
            │  Redis cache     │  │  · ToolCache  ─── SDK  │
            └──────────────────┘  └───────────┬────────────┘
                                              │
              ┌───────────────────────────────┼────────────────────┐
              ▼                               ▼                    ▼
   ┌──────────────────┐          ┌──────────────────┐  ┌──────────────────┐
   │  PostgreSQL :5432│          │  OPA Engine :8181│  │  Redis           │
   │  · Agent memory  │          │  · Rego policies │  │  · LiteLLM cache │
   │  · Workspace data│          │  · tool_auth.rego│  │  · Tool results  │
   │  · Chat history  │          └──────────────────┘  └──────────────────┘
   └──────────────────┘
              All traces → OTel Collector :4318 → Dynatrace
```

All services run on one Docker bridge network (`ai-network`). Containers reach each other by service name (`http://litellm:4000`, `http://opa:8181`) — no hardcoded IPs.

---

## 2. Platform SDK — Separation of Concerns

### Why a shared SDK?

Without a shared SDK, every new service would need to independently implement: authentication, OPA integration, Redis caching, context compaction, structured logging, and OpenTelemetry tracing. That means duplicated code, inconsistent behaviour across services, and bugs fixed in one place but not another.

The `platform-sdk` moves these **cross-cutting concerns** — things that every service needs but that are not the business logic of any single service — into one tested, versioned package. A new service simply imports and calls; it never re-implements.

### The eight SDK modules

```
platform-sdk/platform_sdk/
│
├── config.py        ← "What does this service need to know?"
├── security.py      ← "Is this request allowed?"
├── cache.py         ← "Have we seen this before?"
├── compaction.py    ← "Is the context window getting too full?"
├── agent.py         ← "Build me a LangGraph agent"
│
├── logging.py       ← "Write structured JSON logs"
├── telemetry.py     ← "Emit OpenTelemetry traces"
└── llm_client.py    ← "Call the LLM directly (no agent loop)"
```

Each module has a single, focused responsibility. Here is what each one does and why it belongs in the SDK rather than in individual services.

---

### `config.py` — Typed configuration

**The problem:** Services scattered `os.environ.get("FOO", "default")` calls everywhere. When a default changed or a variable was added, every service had to be updated.

**The solution:** Two typed dataclasses — `AgentConfig` for agent services and `MCPConfig` for MCP servers — each with a `from_env()` classmethod that reads all environment variables once, validates them, and applies bounds-checked defaults.

```python
from platform_sdk import AgentConfig

config = AgentConfig.from_env()
# config.model_route         = "complex-routing" (or AGENT_MODEL_ROUTE)
# config.recursion_limit     = 10 (or AGENT_RECURSION_LIMIT, clamped 1–50)
# config.enable_compaction   = True (or ENABLE_COMPACTION)
# config.context_token_limit = 6000 (or AGENT_CONTEXT_TOKEN_LIMIT)
# config.enable_tool_cache   = True (or ENABLE_TOOL_CACHE)
# config.tool_cache_ttl_seconds = 300 (or TOOL_CACHE_TTL)
```

```python
from platform_sdk import MCPConfig

config = MCPConfig.from_env()
# config.opa_url             = "http://opa:8181/v1/data/mcp/tools/allow"
# config.opa_timeout_seconds = 2.0
# config.max_result_bytes    = 15_000
# config.environment         = "local" (or ENVIRONMENT)
# config.agent_role          = "data_analyst_agent" (or AGENT_ROLE)
```

---

### `security.py` — OPA client and API key verification

**The problem:** The `data-mcp` service had 40 lines of httpx OPA boilerplate (retry logic, timeout, fail-closed handling, environment stamping). The agent service had 15 lines of inline Bearer token validation. Both would need to be replicated in every new service.

**The solution:** Two reusable components.

`OpaClient` — async OPA decision client:

```python
from platform_sdk import OpaClient, MCPConfig

config = MCPConfig.from_env()
opa    = OpaClient(config)

# In a tool handler:
allowed = await opa.authorize("my_tool_name", {"query": q, "session_id": sid})
if not allowed:
    return "ERROR: Unauthorized."
```

`make_api_key_verifier()` — FastAPI dependency that validates `Authorization: Bearer <key>`:

```python
from platform_sdk import make_api_key_verifier
from fastapi import Depends

verify_api_key = make_api_key_verifier()   # reads INTERNAL_API_KEY from env

@app.post("/chat")
async def chat(body: ChatRequest, _: str = Depends(verify_api_key)):
    ...
```

Both are **fail-closed**: if OPA is unreachable the tool call is denied; if `INTERNAL_API_KEY` is not set all requests are rejected.

---

### `cache.py` — Tool-result caching

**The problem:** Identical SQL queries (e.g. "show me all orders for session X") were hitting PostgreSQL on every agent turn, even when the data hadn't changed.

**The solution:** `ToolResultCache` stores results in Redis keyed by `sha256(tool_name + args)`. It degrades gracefully when `REDIS_HOST` is not set (returns `None` everywhere), so services work in environments without Redis.

`cached_tool(cache)` is a decorator that adds cache get/set transparently:

```python
from platform_sdk import ToolResultCache, cached_tool, MCPConfig

config = MCPConfig.from_env()
cache  = ToolResultCache.from_env(ttl_seconds=config.tool_cache_ttl_seconds)

@mcp.tool()
@cached_tool(cache)
async def my_tool(query: str, session_id: str) -> str:
    # This body is only called on a cache miss.
    # Results that start with "ERROR:" are never cached.
    return await db.fetch(query)
```

The decorator is a transparent no-op when `cache` is `None`.

---

### `compaction.py` — Context window trimming

**The problem:** Long multi-turn conversations accumulate messages until the LLM's context window is exceeded, causing `context_length_exceeded` errors.

**The solution:** `make_compaction_modifier(config)` returns a LangGraph `state_modifier` that trims the oldest messages when the estimated token count exceeds `config.context_token_limit`, while always preserving the system message.

```python
from platform_sdk import AgentConfig
from platform_sdk.compaction import make_compaction_modifier

config   = AgentConfig.from_env()
modifier = make_compaction_modifier(config)
# Pass to create_react_agent via build_agent() — you rarely need this directly.
```

Token counting uses `tiktoken` (accurate) with a character-count heuristic as fallback. When compaction fires it logs `before_tokens` and `after_tokens` so you can tune `AGENT_CONTEXT_TOKEN_LIMIT`.

---

### `agent.py` — ReAct agent factory

**The problem:** Every agent service was duplicating the same 25-line `build_enterprise_agent()` function: create `ChatOpenAI`, wire it to LiteLLM, handle the system prompt, call `create_react_agent`. Compaction wasn't wired in at all.

**The solution:** `build_agent(tools, config, prompt)` encapsulates everything — LLM construction, compaction wiring, LangGraph version compatibility — in one call:

```python
from platform_sdk import AgentConfig, build_agent

config = AgentConfig.from_env()
agent  = build_agent(tools, config=config, prompt=system_prompt)

result = await agent.ainvoke(
    {"messages": [HumanMessage(content=user_msg)]},
    config={"recursion_limit": config.recursion_limit},
)
```

Internally, `build_agent` detects whether the installed LangGraph supports `state_modifier` or `messages_modifier` and uses the right one automatically.

---

### `logging.py` and `telemetry.py` — Observability

Every service calls these at startup:

```python
from platform_sdk import configure_logging, get_logger, setup_telemetry

configure_logging()                          # structlog JSON in containers
setup_telemetry("my-service-name")          # OpenTelemetry (idempotent)
log = get_logger(__name__)

log.info("event_name", key="value", count=42)
# → {"event": "event_name", "key": "value", "count": 42, "timestamp": "..."}
```

`setup_telemetry` is guarded by an `_initialized` flag — safe to call multiple times (e.g. on MCP client reconnect).

---

## 3. Component Reference

### FastAPI
**Location:** `agents/src/server.py`

HTTP server exposing `/chat` and `/health`. Uses lifespan context manager (not `@app.on_event`) to manage the MCP connection. Agent executor and bridge are stored on `app.state`, not as module-level globals. Bearer auth is wired via `make_api_key_verifier()` from the SDK.

### LangGraph
**Location:** `agents/src/graph.py` (uses `platform_sdk.agent.build_agent`)

Orchestrates the ReAct (Reason + Act) loop. The LLM decides whether to call a tool or return a final answer; LangGraph handles the loop, tool invocation, and message accumulation. `create_react_agent` returns a compiled `CompiledGraph` ready for `ainvoke` / `astream_events`.

### LiteLLM
**Location:** `platform/config/litellm-local.yaml`, `litellm-prod.yaml`

Multi-cloud LLM proxy. All agent LLM calls go through it — the agent code never knows which cloud provider it is using. LiteLLM handles: routing (`complex-routing` → Azure GPT-4o, `fast-routing` → Azure GPT-4o-mini), failover (Azure → AWS Bedrock in prod), Redis prompt caching, and rate limiting.

The `master_key` in the LiteLLM YAML must match `INTERNAL_API_KEY` in `.env`.

### MCP (Model Context Protocol)
**Location:** `tools/*/src/server.py`, `agents/src/mcp_bridge.py`

Open protocol (by Anthropic) for connecting agents to tools. The agent connects to an MCP server via SSE at startup, discovers its tools (name + JSON Schema), and holds the connection for the service's lifetime. `MCPToolBridge` in `mcp_bridge.py` converts MCP tool schemas into LangChain `StructuredTool` objects that LangGraph can call.

### FastMCP
**Location:** `tools/data-mcp/src/server.py`

Python framework for writing MCP servers. Handles SSE transport, tool registration, and protocol handshake. You decorate async functions with `@mcp.tool()` and they become MCP-callable tools with schemas derived from type hints automatically.

### Open Policy Agent (OPA)
**Location:** `tools/policies/opa/`

Policy-as-code engine. Every MCP tool call is authorised by OPA before execution — **fail closed** (deny on error). The `OpaClient` in the SDK handles retries, timeouts, and environment/role stamping. Policy logic lives in `tool_auth.rego` and can be updated without redeploying any service (just restart the OPA container).

Test policies without a running container: `make test-policies` (runs `opa test`).

### asyncpg
**Location:** `tools/data-mcp/src/server.py`

Async PostgreSQL driver. Connection pool created once in the FastMCP lifespan and shared across all requests. Queries run in `readonly=True` transactions with `SET search_path TO ws_{session_id}` for per-session schema isolation.

### Redis
Two independent uses, both on the same container:
- **LiteLLM prompt cache** — caches complete LLM responses for identical prompts.
- **Tool result cache** — `ToolResultCache` from the SDK caches MCP tool results.

When Redis is unavailable, both degrade gracefully: LiteLLM falls through to the provider, `ToolResultCache.from_env()` returns `None` and the `@cached_tool` decorator becomes a no-op.

### Chainlit (Chat UI)
**Location:** `tools/chat-ui/chainlit_app.py`

Web chat interface with streaming, collapsible tool-call steps, and conversation history. Sessions are persisted to PostgreSQL via `SQLAlchemyDataLayer`. The `on_chat_resume` hook reconnects MCP and rebuilds the agent so users can continue past conversations seamlessly.

---

## 4. Step-by-Step: Building a New Agent

This walkthrough builds a **Document Analysis Agent** — an agent that can read documents from a hypothetical `docs-mcp` server and answer questions about them. The pattern is identical for any other agent.

### Step 1 — Create the project structure

```bash
mkdir -p agents-docanalysis/src/prompts
touch agents-docanalysis/src/__init__.py
touch agents-docanalysis/src/server.py
touch agents-docanalysis/src/graph.py
touch agents-docanalysis/Dockerfile
touch agents-docanalysis/requirements.txt
```

### Step 2 — Write the requirements

```
# agents-docanalysis/requirements.txt
fastapi>=0.111.0
uvicorn[standard]>=0.30.0
langchain-core>=0.2.0
langchain-openai>=0.1.8
langgraph>=0.2.0
httpx>=0.27.0
```

The `platform-sdk` is **not** listed here — it is installed separately via the `Dockerfile` using `pip install /platform-sdk/`. This keeps it version-controlled in one place.

### Step 3 — Write the Dockerfile

```dockerfile
# agents-docanalysis/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install platform SDK first (changes infrequently → good layer caching)
COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

# Install service dependencies
COPY agents-docanalysis/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service source
COPY agents-docanalysis/src/ ./src/

CMD ["uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "8001"]
```

### Step 4 — Write a system prompt template

```jinja2
{# agents-docanalysis/src/prompts/doc_agent.j2 #}
You are a document analysis assistant. You have access to the following tools:
{% for name in tool_names %}- {{ name }}
{% endfor %}

Use these tools to read documents and answer questions accurately.
Always cite which document you read and what section the answer came from.

RESPONSE FORMAT
- Be concise and factual.
- If a document does not contain the answer, say so explicitly — do not guess.
- When writing mathematical expressions, always use $ for inline math (e.g. $\frac{a}{b}$).
```

### Step 5 — Write `graph.py`

This is the only agent-specific file. It loads the system prompt and calls `build_agent` from the SDK — nothing else is needed.

```python
# agents-docanalysis/src/graph.py
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from platform_sdk import AgentConfig, build_agent

_PROMPT_DIR = Path(__file__).parent / "prompts"
_jinja_env = Environment(loader=FileSystemLoader(str(_PROMPT_DIR)), autoescape=False)


def load_system_prompt(template_name: str, **context) -> str:
    return _jinja_env.get_template(template_name).render(**context)


def build_doc_agent(tools: list):
    config = AgentConfig.from_env()
    tool_names = [t.name for t in tools]
    system_prompt = load_system_prompt("doc_agent.j2", tool_names=tool_names)
    return build_agent(tools, config=config, prompt=system_prompt)
```

That's it. The SDK handles: LLM construction, LiteLLM routing, compaction, context injection, and LangGraph version compatibility.

### Step 6 — Write `server.py`

```python
# agents-docanalysis/src/server.py
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from platform_sdk import AgentConfig, configure_logging, get_logger, make_api_key_verifier, setup_telemetry

# Import the bridge and builder from the same service (not from agents/)
from .mcp_bridge import MCPToolBridge   # copy agents/src/mcp_bridge.py or create a shared one
from .graph import build_doc_agent

configure_logging()
setup_telemetry(os.getenv("SERVICE_NAME", "doc-analysis-agent"))
log = get_logger(__name__)

_config = AgentConfig.from_env()
verify_api_key = make_api_key_verifier()

DOCS_MCP_URL = os.environ.get("DOCS_MCP_SSE_URL", "http://docs-mcp:8082/sse")


@asynccontextmanager
async def lifespan(app: FastAPI):
    bridge = MCPToolBridge(DOCS_MCP_URL)
    await bridge.connect()
    tools = await bridge.get_langchain_tools()
    app.state.agent = build_doc_agent(tools)
    app.state.bridge = bridge
    log.info("agent_ready", tools=[t.name for t in tools])
    yield
    await bridge.disconnect()


app = FastAPI(title="Document Analysis Agent", lifespan=lifespan)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=_config.max_message_length)
    session_id: Optional[str] = "default"


class ChatResponse(BaseModel):
    content: str
    role: str = "assistant"
    session_id: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, req: Request, _: str = Depends(verify_api_key)):
    agent = req.app.state.agent
    try:
        result = await agent.ainvoke(
            {"messages": [HumanMessage(content=body.message)]},
            config={
                "recursion_limit": _config.recursion_limit,
                "configurable": {"thread_id": body.session_id},
            },
        )
        return ChatResponse(content=result["messages"][-1].content, session_id=body.session_id)
    except Exception as exc:
        log.error("chat_error", error=str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="Internal error")
```

### Step 7 — Register in `docker-compose.yml`

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
      AGENT_MODEL_ROUTE: ${AGENT_MODEL_ROUTE:-complex-routing}
      ENABLE_COMPACTION: "true"
      AGENT_CONTEXT_TOKEN_LIMIT: "8000"
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

### Step 8 — Test it

```bash
docker compose up --build doc-analysis-agent -d

curl -X POST http://localhost:8001/chat \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Summarise document id 42", "session_id": "test-001"}'
```

---

## 5. Step-by-Step: Building a New MCP Server

This walkthrough builds a **Web Search MCP Server** — an MCP server that lets agents search the web via a hypothetical search API. The pattern applies to any external API (Salesforce, Jira, S3, etc.).

### Step 1 — Create the project structure

```bash
mkdir -p tools/search-mcp/src
touch tools/search-mcp/src/__init__.py
touch tools/search-mcp/src/server.py
touch tools/search-mcp/Dockerfile
touch tools/search-mcp/requirements.txt
```

### Step 2 — Write the requirements

```
# tools/search-mcp/requirements.txt
fastmcp>=0.1.0
httpx>=0.27.0
```

The `platform-sdk` is installed via the Dockerfile, not listed here.

### Step 3 — Write the Dockerfile

```dockerfile
# tools/search-mcp/Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

COPY tools/search-mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tools/search-mcp/src/ ./src/

CMD ["python", "-m", "src.server"]
```

### Step 4 — Write `server.py`

```python
# tools/search-mcp/src/server.py
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import httpx
from mcp.server.fastmcp import FastMCP

from platform_sdk import (
    MCPConfig,
    OpaClient,
    ToolResultCache,
    cached_tool,
    configure_logging,
    get_logger,
    setup_telemetry,
)

configure_logging()
log = get_logger(__name__)

_config = MCPConfig.from_env()
SEARCH_API_KEY = os.environ.get("SEARCH_API_KEY", "")
SEARCH_API_URL = os.environ.get("SEARCH_API_URL", "https://api.search-provider.com/v1/search")
TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")

# Module-level singletons — set inside lifespan
_opa: Optional[OpaClient] = None
_cache: Optional[ToolResultCache] = None
_http: Optional[httpx.AsyncClient] = None


@asynccontextmanager
async def _lifespan(server: FastMCP) -> AsyncIterator[None]:
    global _opa, _cache, _http

    setup_telemetry(os.environ.get("SERVICE_NAME", "search-mcp"))

    # 1. OPA client — fail-closed policy enforcement (from SDK)
    _opa = OpaClient(_config)

    # 2. Tool-result cache — Redis-backed (from SDK, degrades gracefully)
    _cache = ToolResultCache.from_env(ttl_seconds=_config.tool_cache_ttl_seconds) \
             if _config.enable_tool_cache else None

    # 3. HTTP client for the upstream search API
    _http = httpx.AsyncClient(
        base_url=SEARCH_API_URL,
        headers={"Authorization": f"Bearer {SEARCH_API_KEY}"},
        timeout=10.0,
    )

    log.info("startup_complete", transport=TRANSPORT)
    yield

    # Teardown
    if _http:
        await _http.aclose()
    if _opa:
        await _opa.aclose()
    if _cache:
        await _cache.aclose()
    log.info("shutdown_complete")


if TRANSPORT == "sse":
    mcp = FastMCP("Web Search MCP", lifespan=_lifespan, host="0.0.0.0", port=8082)
else:
    mcp = FastMCP("Web Search MCP", lifespan=_lifespan)


@mcp.tool()
@cached_tool(_cache)  # Note: _cache is None at decoration time — SDK handles this correctly
async def web_search(query: str, session_id: str, max_results: int = 5) -> str:
    """
    Search the web and return a summary of the top results.

    Args:
        query:       The search query.
        session_id:  The agent's session UUID (used for audit logging).
        max_results: Maximum number of results to return (1–10).

    Returns:
        JSON-encoded list of results, or an error string.
    """
    # 1. OPA authorisation — every tool call, every time
    allowed = await _opa.authorize("web_search", {"query": query, "session_id": session_id})
    if not allowed:
        return "ERROR: Unauthorized. Execution blocked by policy engine."

    # 2. Input validation
    max_results = max(1, min(max_results, 10))
    if not query.strip():
        return "ERROR: Query must not be empty."

    # 3. Call the upstream API
    try:
        response = await _http.get("", params={"q": query, "count": max_results})
        response.raise_for_status()
        results = response.json().get("results", [])

        if not results:
            return "No results found for the given query."

        # Format for the agent — structured text is easier to reason about than raw JSON
        formatted = "\n\n".join(
            f"[{i+1}] {r['title']}\nURL: {r['url']}\n{r.get('snippet', '')}"
            for i, r in enumerate(results)
        )
        log.info("search_ok", session_id=session_id, result_count=len(results))
        return formatted

    except httpx.HTTPStatusError as exc:
        log.error("search_api_error", status=exc.response.status_code, error=str(exc))
        return f"ERROR: Search API returned status {exc.response.status_code}."
    except Exception as exc:
        log.error("search_error", error=str(exc))
        return "ERROR: An unexpected error occurred while searching."


if __name__ == "__main__":
    mcp.run(transport=TRANSPORT)
```

### Step 5 — Add an OPA allow rule

Open `tools/policies/opa/tool_auth.rego` and add a rule for your new tool:

```rego
# Allow agents to call web_search
allow {
    input.tool == "web_search"
    allowed_roles[input.agent_role]
    input.session_id != ""
}
```

Then add a unit test in `tool_auth_test.rego`:

```rego
test_web_search_allowed {
    allow with input as {
        "tool": "web_search",
        "agent_role": "data_analyst_agent",
        "session_id": "test-session-id",
        "query": "enterprise AI trends"
    }
}

test_web_search_empty_session_denied {
    not allow with input as {
        "tool": "web_search",
        "agent_role": "data_analyst_agent",
        "session_id": "",
        "query": "test"
    }
}
```

Run the tests: `make test-policies`

### Step 6 — Register in `docker-compose.yml`

```yaml
  search-mcp:
    build:
      context: .
      dockerfile: tools/search-mcp/Dockerfile
    container_name: ai-search-mcp
    environment:
      MCP_TRANSPORT: sse
      OPA_URL: http://opa:8181/v1/data/mcp/tools/allow
      SEARCH_API_KEY: ${SEARCH_API_KEY}
      SEARCH_API_URL: ${SEARCH_API_URL}
      SERVICE_NAME: search-mcp
      ENVIRONMENT: ${ENVIRONMENT:-local}
      AGENT_ROLE: ${AGENT_ROLE:-data_analyst_agent}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      ENABLE_TOOL_CACHE: "true"
      TOOL_CACHE_TTL: "60"       # Search results stale faster than DB data
      <<: *otel-env
    depends_on:
      redis:
        condition: service_healthy
      opa:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python3", "-c",
             "import socket,sys; s=socket.socket(); r=s.connect_ex(('localhost',8082)); s.close(); sys.exit(0 if r==0 else 1)"]
      interval: 15s
      timeout: 5s
      retries: 5
    networks:
      - ai-network
    ports:
      - "127.0.0.1:8082:8082"
```

### Step 7 — Fix the `@cached_tool` decoration timing

The `@cached_tool(_cache)` decorator is applied at import time, but `_cache` is assigned inside `_lifespan` (at startup). This means the decorator captures `None` and becomes a no-op. Fix this by applying the cache wrapper inside the lifespan, or by using the manual cache API directly inside the tool function body:

```python
# Preferred pattern — explicit cache lookup inside the tool
@mcp.tool()
async def web_search(query: str, session_id: str, max_results: int = 5) -> str:
    ...
    # Manual cache check (safe — _cache may still be None if Redis is not configured)
    if _cache:
        from platform_sdk.cache import make_cache_key
        key = make_cache_key("web_search", {"query": query, "max_results": max_results})
        cached = await _cache.get(key)
        if cached:
            return cached

    result = await _do_search(query, max_results)

    if _cache and not result.startswith("ERROR:"):
        await _cache.set(key, result)

    return result
```

### Step 8 — Test the tool in isolation

```bash
# Start just the tool and its dependencies
docker compose up --build search-mcp opa redis -d

# Connect to the MCP server manually with the MCP Inspector (optional)
npx @modelcontextprotocol/inspector http://localhost:8082/sse

# Or call it via an agent that has the tool
curl -X POST http://localhost:8000/chat \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Search for recent news about enterprise AI", "session_id": "test-001"}'
```

### What the SDK handles for you in both steps

| Concern | Without SDK | With SDK |
|---|---|---|
| Configuration | 10+ `os.environ.get()` calls scattered through the file | `MCPConfig.from_env()` — one call, fully typed |
| OPA enforcement | ~40 lines of httpx, retry, timeout, fail-closed logic | `OpaClient(_config).authorize(tool, input)` |
| Caching | Redis connection, key generation, error handling, TTL | `ToolResultCache.from_env()` + `make_cache_key()` |
| Structured logging | `import logging; logging.getLogger()` (no kwarg support) | `get_logger(__name__)` — JSON, keyword args |
| Tracing | 15+ lines of OTel setup + `_initialized` guard | `setup_telemetry("service-name")` |

---

## 6. Environment Variables

All configuration is injected via environment variables. Never hardcode values. See `.env.example` for the full list.

| Variable | Used by | Purpose |
|---|---|---|
| `INTERNAL_API_KEY` | All services | Shared Bearer token — agent↔LiteLLM, client↔agent |
| `AZURE_API_KEY` | LiteLLM | Azure OpenAI credential |
| `AZURE_API_BASE` | LiteLLM | Azure OpenAI endpoint URL |
| `AZURE_API_VERSION` | LiteLLM | API version |
| `POSTGRES_PASSWORD` | pgvector, data-mcp | Database password |
| `REDIS_PASSWORD` | Redis, LiteLLM, data-mcp | Redis auth password |
| `REDIS_HOST` | data-mcp, any MCP server | Redis hostname for `ToolResultCache` |
| `REDIS_PORT` | data-mcp, any MCP server | Redis port (default 6379) |
| `AGENT_MODEL_ROUTE` | Agent services | LiteLLM route name for agent calls |
| `ENABLE_COMPACTION` | Agent services | `true`/`false` — context trimming on/off |
| `AGENT_CONTEXT_TOKEN_LIMIT` | Agent services | Token budget before compaction fires |
| `AGENT_RECURSION_LIMIT` | Agent services | Max tool-call iterations (1–50) |
| `MAX_MESSAGE_LENGTH` | Agent services | Max user message bytes |
| `ENABLE_TOOL_CACHE` | MCP servers | `true`/`false` — Redis tool cache on/off |
| `TOOL_CACHE_TTL` | MCP servers | Cache TTL in seconds |
| `OPA_URL` | MCP servers | OPA decision endpoint |
| `ENVIRONMENT` | MCP servers | `local`/`prod` — stamped into OPA input |
| `AGENT_ROLE` | MCP servers | Role stamped into OPA input |
| `LITELLM_BASE_URL` | Agent services | LiteLLM proxy URL |
| `MCP_SSE_URL` | Agent services | MCP server SSE endpoint |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | All services | OTel collector OTLP HTTP endpoint |
| `DYNATRACE_ENDPOINT` | OTel Collector | Dynatrace ingest URL (optional) |
| `DYNATRACE_API_TOKEN` | OTel Collector | Dynatrace API token (optional) |

---

## 7. Data Flow: A Single Chat Request

1. Client sends `POST /chat` with `Authorization: Bearer <INTERNAL_API_KEY>`.
2. `make_api_key_verifier()` (SDK) validates the token — 401 if invalid.
3. LangGraph's ReAct loop starts. The LLM (via LiteLLM → Azure OpenAI) reasons about the request.
4. If LiteLLM has seen an identical prompt recently, it returns the cached response immediately (Redis prompt cache — no Azure round-trip).
5. `make_compaction_modifier` (SDK) trims the message list if the token count exceeds the budget.
6. If the LLM decides to call a tool, the MCP bridge sends the call to `data-mcp` over the open SSE connection.
7. `OpaClient.authorize()` (SDK) sends `POST http://opa:8181/v1/data/mcp/tools/allow` — fail closed if OPA is unreachable.
8. `ToolResultCache.get()` (SDK) checks Redis — if the exact same query was run recently, the cached result is returned immediately (no DB round-trip).
9. On a cache miss, data-mcp runs the SELECT query in the agent's workspace schema via asyncpg.
10. `ToolResultCache.set()` (SDK) stores the result in Redis for future calls.
11. The query result is returned to LangGraph as a tool observation.
12. The LLM incorporates the result and either calls another tool (back to step 5) or produces a final answer.
13. FastAPI returns `{"content": "...", "role": "assistant", "session_id": "..."}`.

Every step emits an OTel span — the full trace is visible in Dynatrace with agent→LiteLLM→MCP→OPA→DB latency broken down per hop.
