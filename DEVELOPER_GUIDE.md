# Developer Guide — Enterprise AI Platform

This guide explains the role of every technology in the stack, why it was chosen, and how the components fit together. Read this before making architectural changes.

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│  Developer / Client                                     │
│  curl / Invoke-RestMethod / SDK                         │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP POST /chat  (Bearer token)
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Agent Service  (FastAPI + LangGraph)   :8000           │
│  agents/src/server.py                                   │
│  - Authenticates request (HTTPBearer)                   │
│  - Runs LangGraph ReAct loop                            │
│  - Calls MCP tools when needed                          │
└──────────────┬──────────────────────┬───────────────────┘
               │ LLM calls            │ Tool calls (SSE)
               ▼                      ▼
┌──────────────────────┐  ┌──────────────────────────────┐
│  LiteLLM Proxy :4000 │  │  Data MCP Server  :8080      │
│  platform/config/    │  │  tools/data-mcp/src/         │
│  - Azure OpenAI      │  │  - OPA policy check          │
│  - AWS Bedrock       │  │  - SQL SELECT only           │
│    (prod fallback)   │  │  - asyncpg connection pool   │
└──────────────────────┘  └──────────┬───────────────────┘
                                     │
               ┌─────────────────────┼──────────────────┐
               ▼                     ▼                   ▼
┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐
│  PostgreSQL      │  │  OPA Engine      │  │  OTel Collector   │
│  (pgvector) :5432│  │  :8181           │  │  :4317 / :4318    │
│  - Agent memory  │  │  - Policy as code│  │  → Dynatrace      │
│  - Workspace data│  │  - Rego rules    │  │                   │
└──────────────────┘  └──────────────────┘  └───────────────────┘
```

All services run on one Docker bridge network (`ai-network`). Containers reach each other by service name — no `host.docker.internal` or hardcoded IPs.

---

## Component Reference

### FastAPI
**Location:** `agents/src/server.py`
**Role:** HTTP server that exposes the `/chat` endpoint to callers.

FastAPI was chosen for its native async support (needed for LangGraph's async graph execution), automatic OpenAPI docs, and Pydantic integration for request/response validation. Key design choices in this codebase:

- **Lifespan context manager** (`@asynccontextmanager`) replaces the deprecated `@app.on_event("startup")` pattern. All async resources (MCP connection) are created and destroyed here.
- **`app.state`** holds the agent executor and MCP bridge — no module-level mutable globals.
- **`HTTPBearer`** validates the `Authorization: Bearer <key>` header on every request.
- **`/health`** endpoint exists for Kubernetes liveness/readiness probes with no auth required.

---

### LangGraph
**Location:** `agents/src/graph.py`
**Role:** Orchestrates the ReAct (Reason + Act) loop that decides when to call tools vs when to respond.

LangGraph is a graph-based agent framework from LangChain. The ReAct pattern works as follows:

1. LLM receives the user message and a list of available tools.
2. LLM reasons about whether a tool is needed.
3. If yes, LangGraph invokes the tool and feeds the result back to the LLM.
4. The loop repeats until the LLM produces a final answer without requesting a tool.

`create_react_agent(llm, tools, prompt=system_prompt)` returns a compiled `CompiledGraph`. This graph is stateless — memory and session context are managed by PostgreSQL via a checkpointer (see `platform/db/init.sql` for the schema).

**System prompt:** loaded from a Jinja2 template (`agents/src/prompts/enterprise_agent.j2`) so prompt changes can be reviewed in git without touching Python code.

---

### LangChain OpenAI (`langchain-openai`)
**Location:** `agents/src/graph.py`
**Role:** Provides the `ChatOpenAI` class used as the LLM inside the LangGraph agent.

`ChatOpenAI` is configured to point at the **LiteLLM proxy** (`LITELLM_BASE_URL`) rather than directly at Azure or OpenAI. This means the agent code has no knowledge of which cloud provider it is using — that routing decision lives entirely in LiteLLM config.

---

### LiteLLM
**Location:** `platform/config/litellm-local.yaml`, `platform/config/litellm-prod.yaml`
**Role:** Multi-cloud LLM proxy. Translates OpenAI-compatible API calls into provider-specific requests (Azure, AWS Bedrock, Anthropic, etc.).

This is the most important architectural decision in the platform. By routing all LLM calls through LiteLLM:

- **No vendor lock-in** — swap from Azure to AWS Bedrock by editing a YAML file, with zero agent code changes.
- **Automatic failover** — `litellm-prod.yaml` configures Azure as primary and AWS Bedrock Claude 3.5 Sonnet as fallback. If Azure returns errors, LiteLLM fails over automatically.
- **Unified auth** — the agent uses one `INTERNAL_API_KEY` to talk to LiteLLM; LiteLLM holds the actual cloud credentials.
- **Rate limiting and caching** — Redis-backed prompt caching eliminates redundant API calls for repeated inputs.

The `master_key` in the LiteLLM config must match `INTERNAL_API_KEY` in `.env`. All callers (agents, tests, developers) use this key.

---

### MCP (Model Context Protocol)
**Location:** `tools/data-mcp/src/server.py`, `agents/src/mcp_bridge.py`
**Role:** Standardised protocol for connecting agents to tools (databases, APIs, file systems).

MCP is an open protocol by Anthropic that separates **tool definition** (the MCP server) from **tool consumption** (the agent). Benefits:

- Tool servers are independently deployable services.
- Any MCP-compatible agent framework can consume the same tool without changes.
- Tools self-describe their input schemas — the agent bridge reads these at startup and builds typed Pydantic models dynamically (`_build_args_model` in `mcp_bridge.py`).

The transport used here is **SSE (Server-Sent Events)** over HTTP. The agent connects to `http://data-mcp:8080/sse` at startup and holds the connection open for the lifetime of the service.

---

### FastMCP
**Location:** `tools/data-mcp/src/server.py`
**Role:** Python framework that simplifies writing MCP servers.

`FastMCP` handles the SSE transport, tool registration, and MCP protocol handshake. You decorate a Python function with `@mcp.tool()` and it becomes a callable tool with a JSON Schema automatically derived from the type hints.

Key usage pattern:
```python
mcp = FastMCP("Enterprise Data MCP", lifespan=_lifespan, host="0.0.0.0", port=8080)

@mcp.tool()
async def execute_read_query(query: str, session_id: str) -> str:
    ...
```

The `lifespan` parameter is critical — it ensures async resources (DB pool, HTTP client) are created inside FastMCP's event loop, not in a separate `asyncio.run()` call that would leave them on a dead loop.

---

### Open Policy Agent (OPA)
**Location:** `tools/policies/opa/tool_auth.rego`, `tools/policies/opa/tool_auth_test.rego`
**Role:** Policy-as-code engine. Every MCP tool call is authorised by OPA before execution.

OPA evaluates Rego policies against a JSON input. The data-mcp server sends a request to OPA's REST API (`http://opa:8181/v1/data/mcp/tools/allow`) before every tool invocation. If OPA returns `false` or errors, the tool call is denied — **fail closed**.

The policy in `tool_auth.rego` enforces:
- Only `agent_admin` and `agent_readonly` roles may call tools.
- Only `SELECT` queries are permitted (regex check in Rego as a second layer of defence).
- `session_id` must be a non-empty string.
- Local environment bypass: `environment == "local"` skips role checks for developer convenience.

The OPA container loads policies from the mounted `tools/policies/opa/` directory at startup. Policy changes take effect after `docker restart ai-opa` — no code deployment needed.

**Testing policies:** `make test-policies` runs the 9 unit tests in `tool_auth_test.rego` using the OPA CLI directly (no running container needed).

---

### asyncpg
**Location:** `tools/data-mcp/src/server.py`
**Role:** Async PostgreSQL driver. Provides the connection pool for all database queries.

`asyncpg` is the fastest Python PostgreSQL driver and natively async, making it ideal for FastAPI/MCP services that need to handle concurrent requests without blocking. The pool (`asyncpg.create_pool`) is created once at startup inside the FastMCP lifespan and shared across all tool invocations.

All queries run inside a `readonly=True` transaction with `SET search_path TO ws_{session_id}` to enforce per-session schema isolation. This means an agent with `session_id = "abc-123"` can only see data in the `ws_abc_123` schema.

---

### pgvector / PostgreSQL
**Location:** `platform/db/init.sql`
**Role:** Primary datastore for agent memory (LangGraph checkpoints) and workspace data.

The `pgvector` extension enables vector similarity search, which is required for semantic memory retrieval in more advanced agent patterns. The `init.sql` creates:

- `checkpoints` and `checkpoint_writes` — LangGraph's PostgresSaver tables for persisting agent conversation state across requests.
- `agent_audit_log` — immutable compliance log of every agent action.
- Example `workspaces` schema with sample data for integration testing.

---

### platform-sdk
**Location:** `platform-sdk/platform_sdk/`
**Role:** Shared Python package installed into every service container. Eliminates code duplication.

The SDK provides three modules:

- **`llm_client.py`** — `EnterpriseLLMClient` wraps the LiteLLM API with enterprise defaults.
- **`telemetry.py`** — `setup_telemetry(service_name)` initialises OpenTelemetry. Idempotent and silently skips if `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, so unit tests work without an OTel collector.
- **`logging.py`** — `configure_logging()` sets up structlog. `get_logger(name)` returns a structlog-bound logger that accepts keyword arguments (`log.info("event", key=value)`).

Installed into containers via `pip install /platform-sdk/` in each Dockerfile. Installed locally via `make sdk-install` which creates a `.venv/` and installs in editable mode.

---

### structlog
**Location:** `platform-sdk/platform_sdk/logging.py`
**Role:** Structured JSON logging. Replaces `print()` and standard `logging.getLogger()` calls.

structlog produces machine-readable JSON in containers (for log aggregation) and coloured human-readable output in terminals. The key difference from standard logging: you pass context as keyword arguments rather than interpolating strings:

```python
log.info("query_executed", session_id=session_id, rows=len(records))
# Produces: {"event": "query_executed", "session_id": "abc-123", "rows": 42, ...}
```

This makes logs directly queryable in Dynatrace/Splunk/Datadog without log parsing rules.

**Important:** Always use `get_logger()` from `platform_sdk`, not `logging.getLogger()`. The standard logger does not accept keyword arguments and will raise `TypeError` at runtime.

---

### OpenTelemetry
**Location:** `platform-sdk/platform_sdk/telemetry.py`, `platform/otel/otel-local.yaml`
**Role:** Distributed tracing. Every request gets a trace ID that follows it through all services.

The OTel SDK instruments FastAPI automatically. Traces are exported to the OTel Collector container via OTLP HTTP (`http://otel-collector:4318/v1/traces`), which then forwards them to Dynatrace. In local development, set `DYNATRACE_ENDPOINT` and `DYNATRACE_API_TOKEN` in `.env` to see traces. If not set, traces are collected but not exported — development still works normally.

---

### Redis
**Location:** `docker-compose.yml` (service: `redis`)
**Role:** Prompt cache for LiteLLM. Eliminates redundant LLM API calls for identical inputs.

LiteLLM's semantic cache checks Redis before forwarding a request to Azure/Bedrock. If the same prompt was seen recently, the cached response is returned instantly — significant cost and latency savings in high-traffic scenarios. Redis is stateless for this use case (cache can be cold-started without data loss).

---

### Docker Compose
**Location:** `docker-compose.yml`
**Role:** Orchestrates the full local development stack as a single-network set of containers.

All 7 services run on the `ai-network` bridge network. Inter-service communication uses container names as hostnames (`http://litellm:4000`, `http://opa:8181`). This exactly mirrors production Kubernetes DNS, so there are no `localhost` vs container-name discrepancies between environments.

Every service has a `healthcheck` and uses `depends_on: condition: service_healthy` to ensure startup ordering is correct. Environment variables flow from `.env` → `docker-compose.yml` → container environment.

---

### Skaffold
**Location:** `skaffold.yaml`
**Role:** Kubernetes development workflow. One command (`make k8s-dev`) builds images, pushes to a registry, and deploys to a cluster using Helm.

Three profiles:
- `local` — Docker Compose (default for development).
- `dev-cluster` — builds and deploys to an EKS/AKS dev namespace via Helm.
- `production` — full production deployment with prod Helm values.

Skaffold watches source files and triggers rebuilds automatically during `skaffold dev`, making the inner loop for Kubernetes development fast.

---

### Helm
**Location:** `infra/helm/`
**Role:** Kubernetes package manager. Parameterises raw Kubernetes YAML so the same chart deploys to dev and prod with different values.

Each service has its own chart (`ai-platform`, `data-mcp`, `ai-agents`) with:
- `values.yaml` — defaults.
- `values-dev.yaml` — overrides for the dev cluster (smaller replicas, no HPA).
- `values-prod.yaml` — overrides for production (resource limits, HPA, prod image tags).

All sensitive values (API keys, DB passwords) are referenced by Kubernetes Secret name — never hardcoded in chart values.

---

### Terraform
**Location:** `infra/terraform/rds/`
**Role:** Infrastructure as code for AWS resources. Provisions the production RDS PostgreSQL instance.

Key decisions:
- **Remote state** in S3 with DynamoDB locking prevents concurrent `terraform apply` conflicts.
- **DB password** read from AWS Secrets Manager at plan time — never passed on the command line or stored in `.tfvars`.
- `skip_final_snapshot = false` and `multi_az = true` are the defaults, making it safe to run `terraform apply` without flags against production. Dev overrides these in `environments/dev.tfvars`.

---

## Environment Variables

All configuration is injected via environment variables. Never hardcode values. See `.env.example` for the full list with descriptions.

| Variable | Used by | Purpose |
|---|---|---|
| `AZURE_API_KEY` | LiteLLM | Azure OpenAI credential |
| `AZURE_API_BASE` | LiteLLM | Azure OpenAI endpoint URL |
| `AZURE_API_VERSION` | LiteLLM | API version (e.g. `2024-02-15-preview`) |
| `AWS_ACCESS_KEY_ID` | LiteLLM (prod) | AWS credential for Bedrock fallback |
| `AWS_SECRET_ACCESS_KEY` | LiteLLM (prod) | AWS credential for Bedrock fallback |
| `INTERNAL_API_KEY` | All services | Shared secret — agent↔LiteLLM auth |
| `POSTGRES_PASSWORD` | pgvector, data-mcp | Database password |
| `DYNATRACE_ENDPOINT` | OTel Collector | Dynatrace OTLP ingest URL |
| `DYNATRACE_API_TOKEN` | OTel Collector | Dynatrace API token |
| `LITELLM_BASE_URL` | Agent service | LiteLLM proxy URL |
| `MCP_SSE_URL` | Agent service | Data MCP SSE endpoint |

---

## Data Flow: A Single Chat Request

1. Client sends `POST /chat` with `Authorization: Bearer <INTERNAL_API_KEY>`.
2. FastAPI validates the bearer token against `INTERNAL_API_KEY`.
3. LangGraph's ReAct loop starts. The LLM (via LiteLLM → Azure OpenAI) decides if a tool is needed.
4. If a tool is needed, the MCP bridge calls `session.call_tool("execute_read_query", {...})` over the SSE connection to data-mcp.
5. data-mcp sends `POST http://opa:8181/v1/data/mcp/tools/allow` with the tool name, query, and session ID.
6. OPA evaluates the Rego policy and returns `{"result": true}` or `{"result": false}`.
7. If allowed, data-mcp acquires a connection from the asyncpg pool and runs the SELECT query in the agent's workspace schema.
8. The query result is returned to LangGraph as a tool observation.
9. The LLM incorporates the result and either calls another tool or produces a final answer.
10. FastAPI returns `{"content": "...", "role": "assistant", "session_id": "..."}`.

Every step emits an OTel span, so the entire trace is visible in Dynatrace.

---

## Adding a New Service

1. Create `tools/<name>/` with `Dockerfile`, `requirements.txt`, `src/server.py`.
2. Add it to `docker-compose.yml` following the `data-mcp` pattern (healthcheck, `ai-network`, `depends_on`).
3. Add an OPA allow rule in `tools/policies/opa/tool_auth.rego`.
4. Write OPA unit tests in `tools/policies/opa/tool_auth_test.rego`.
5. Add a Helm chart in `infra/helm/<name>/`.
6. Add the service to `skaffold.yaml` under the `dev-cluster` profile.
