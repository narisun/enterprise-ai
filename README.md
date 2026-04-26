# Enterprise AI — Agentic Platform

Enterprise AI is an agentic platform for regulated financial-services workflows. It combines:

- Secure agent services built with LangGraph and FastAPI
- MCP tool servers for CRM, payments, news, and SQL access
- A shared `platform-sdk` for auth, policy enforcement, caching, logging, and telemetry
- A single Docker stack that runs identically on macOS (dev) and a Linux VM (cloud)

The project includes:

- **`analytics-agent`** — primary analytics agent (LangGraph, four-layer SoC/DI architecture)
- **`ai-agents`** — generic ReAct chat agent backed by a secure SQL MCP server
- **`analytics-dashboard`** — Next.js + Auth0 visualization frontend
- **Four MCP tool servers** — `data-mcp`, `salesforce-mcp`, `payments-mcp`, `news-search-mcp`

## Contents

- [Quick Start](#quick-start)
- [The Four Make Targets](#the-four-make-targets)
- [Local Endpoints](#local-endpoints)
- [Verify It Works](#verify-it-works)
- [How It Works](#how-it-works)
- [Observability](#observability)
- [Testing](#testing)
- [Repository Structure](#repository-structure)
- [Troubleshooting](#troubleshooting)
- [Further Reading](#further-reading)

## Quick Start

### Prerequisites

The same setup runs on **macOS for development** and a **Linux VM in cloud** — same `docker-compose.yml`, same Make targets, same fixtures.

Required tools:

- **Docker Desktop** (macOS) or **Docker Engine** (Linux)
- **Python 3.11+**
- **Make**
- **git**

Everything else — PostgreSQL, Redis, OPA, OTel, LiteLLM, the agents, MCP servers, and the dashboard — runs as Docker containers managed by `make`.

### One-time setup

```bash
git clone https://github.com/narisun/enterprise-ai.git
cd enterprise-ai
cp .env.example .env
# Fill in required secrets in .env (see below)
make setup
```

`make setup` is the canonical "make it work from a clean state" command. It:

1. Creates the Python virtual environment at `.venv/`
2. Installs `platform-sdk` in editable mode
3. Wipes any existing Docker volumes
4. Rebuilds all images
5. Brings up the entire 12-container stack
6. Loads the `bankdw.*` and `salesforce.*` test fixtures from `testdata/`

When it finishes you'll see "Stack ready" with URLs printed.

### Required `.env` values

The minimum to run the stack:

| Variable | Purpose |
|---|---|
| `AZURE_API_KEY` | Azure OpenAI key (or any LiteLLM-compatible provider key) |
| `AZURE_API_BASE` | LLM endpoint URL |
| `INTERNAL_API_KEY` | Service-to-service Bearer token |
| `JWT_SECRET` | HS256 signing key |
| `CONTEXT_HMAC_SECRET` | HMAC-SHA256 secret for `X-Agent-Context` |
| `POSTGRES_PASSWORD` | Postgres admin password |
| `REDIS_PASSWORD` | Redis password |

Generate the cryptographic secrets:

```bash
python3 -c "import secrets; print('sk-ent-' + secrets.token_hex(24))"  # INTERNAL_API_KEY
python3 -c "import secrets; print(secrets.token_hex(32))"             # JWT_SECRET / CONTEXT_HMAC_SECRET
python3 -c "import secrets; print(secrets.token_hex(16))"             # POSTGRES_PASSWORD / REDIS_PASSWORD
```

Auth0 keys (`AUTH0_*`) are only needed if you want the Auth0 login flow on the dashboard; otherwise the dashboard exposes a dev-bypass path.

## The Four Make Targets

```
make setup     Wipe volumes, rebuild images, load fresh test data
make start     Start anything not yet running (preserves data)
make stop      Stop everything (preserves data)
make restart   Stop then start
make help      Show this help
```

Day-to-day mapping:

| Situation | Command |
|---|---|
| Fresh clone or "give me a clean slate" | `make setup` |
| Laptop just woke up; resume where you left off | `make start` |
| Done for now; free up RAM | `make stop` |
| Changed `.env` — Docker only reads it on container `up` | `make restart` |
| Changed Dockerfiles or seed SQL | `make setup` |

## Local Endpoints

After `make setup`:

| Interface | URL | Notes |
|---|---|---|
| Analytics Dashboard | http://localhost:3003 | Next.js + Vercel AI SDK |
| Analytics Agent API | http://localhost:8086 | FastAPI; LangGraph orchestrator |
| Generic Agent API | http://localhost:8000 | Legacy ReAct chat agent |
| LiteLLM Proxy | http://localhost:4000 | LLM routing |
| OPA | http://localhost:8181 | Policy engine |
| Data MCP | http://localhost:8080 | Secure read-only SQL |
| Salesforce MCP | http://localhost:8081 | CRM |
| Payments MCP | http://localhost:8082 | Payments analytics |
| News MCP | http://localhost:8083 | News (Tavily, falls back to mocks) |
| OTel — OTLP HTTP | http://localhost:4318 | Trace ingest |
| OTel — OTLP gRPC | http://localhost:4317 | Trace ingest |
| OTel — health | http://localhost:13133/ | Collector liveness |
| OTel — self-metrics | http://localhost:8888/metrics | Prometheus format |
| PostgreSQL | localhost:5432 | `ai_memory` + `bankdw.*` + `salesforce.*` schemas |

All host ports are bound to `127.0.0.1` only.

## Verify It Works

```bash
# Health checks
curl -s http://localhost:8086/health   # analytics-agent
curl -s http://localhost:8000/health   # generic agent
curl -s http://localhost:13133/        # OTel collector

# Live request through the analytics-agent (streams Vercel Data Stream Protocol)
curl -N -X POST http://localhost:8086/api/v1/analytics/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Email: alice@example.com" \
  -H "X-User-Role: manager" \
  -d '{"id":"test-001","messages":[{"role":"user","content":"Show top 3 accounts by revenue"}]}'

# Watch traces flow through OTel as the request runs
docker logs -f ai-otel-collector
```

## How It Works

### High-level architecture

```
Browser / API client
  └─> Analytics Dashboard (Next.js + Auth0)
        └─> Analytics Agent (FastAPI + LangGraph StateGraph)
              ├─> intent_router      → classify query, build query plan
              ├─> mcp_tool_caller    → fetch data via MCP servers
              │     ├─> data-mcp        → bankdw SQL (read-only, parameterised)
              │     ├─> salesforce-mcp  → CRM with row-level access control
              │     ├─> payments-mcp   → payments with column masking
              │     └─> news-search-mcp → company news
              └─> synthesis          → narrative + UI components

Cross-cutting:
  └─> platform-sdk    — UserContext, OPA checks, cache, resilience
  └─> OPA             — fail-closed policy decisions
  └─> Redis           — tool-result cache, rate-limit counters
  └─> OpenTelemetry   — distributed traces → OTel collector → stdout (debug exporter)
```

### Core design ideas

**Constructor injection everywhere.** No module-level state, no globals, no import-time I/O. Every class takes its dependencies via `__init__`. See `docs/architecture/agent-reference-pattern.md` for the full pattern.

**Protocols owned by the consumer.** `agents/analytics-agent/src/ports.py` defines the interfaces. SDK adapters in `platform-sdk/` structurally satisfy them; the SDK never imports from any agent (Dependency Inversion).

**Pure factory + lifespan.** `create_app(deps: AppDependencies) -> FastAPI` is pure — no env reads, no I/O. `lifespan(app)` is the only place that performs startup I/O.

**Class-based domain nodes.** `IntentRouterNode`, `MCPToolCallerNode`, `SynthesisNode`, `ErrorHandlerNode` — each is a callable class instantiated by `build_analytics_graph(deps)` from a `GraphDependencies` dataclass.

**Tenant-scoped checkpoints.** `make_thread_id(user_id, session_id)` derives the LangGraph `thread_id` server-side so two users sharing a session UUID never collide on the checkpointer.

**Four test tiers.** unit / component / application / integration. The default `pytest` run covers the first three with no Docker.

### Security model

1. Dashboard authenticates the caller via Auth0 (or dev-bypass header)
2. Dashboard forwards `X-User-Email` + `X-User-Role` to the analytics-agent (trusted because the request requires `INTERNAL_API_KEY`)
3. The agent builds a `UserContext`; HMAC-signs an `AgentContext` and forwards it to MCP servers as `X-Agent-Context`
4. MCP servers verify the signature
5. OPA decides whether each tool call is allowed (fail-closed)
6. MCP servers apply row filters and column masks before returning data

## Observability

The OTel collector receives spans on `:4317` (gRPC) and `:4318` (HTTP) and prints them to its own stdout via the `debug` exporter at `verbosity=detailed`.

```bash
# Watch traces in real time
docker logs -f ai-otel-collector

# Span/metric counters
curl -s http://localhost:8888/metrics | grep -E "^otelcol_(receiver_accepted|exporter_sent)"

# Collector health
curl -s http://localhost:13133/
```

To upgrade to a hosted backend (Langfuse, Datadog, Honeycomb, etc.):

1. Add the exporter to `platform/otel/otel-local.yaml`
2. Append it to `service.pipelines.traces.exporters`
3. `make restart`

No application code changes are required.

## Testing

The fast tests run without Docker:

```bash
.venv/bin/pytest tests/unit/ -q                          # platform-sdk Layer 1 (86 tests)
.venv/bin/pytest agents/analytics-agent/tests/unit/ -q   # domain/ports/fakes/helpers
.venv/bin/pytest agents/analytics-agent/tests/component/ -q
.venv/bin/pytest agents/analytics-agent/tests/application/ -q  # FastAPI TestClient + fakes
```

Integration tests against the running stack (require `make setup` first):

```bash
.venv/bin/pytest tests/integration/test_payments_sql.py -m integration  # 14 tests, real Postgres
.venv/bin/pytest tests/integration/test_opa_policies.py -m integration  # OPA decisions
```

## Repository Structure

```
enterprise-ai/
├── agents/
│   ├── src/                       # Generic chat agent (legacy ReAct)
│   └── analytics-agent/
│       ├── src/
│       │   ├── app.py             # create_app(deps) factory + lifespan
│       │   ├── app_dependencies.py
│       │   ├── ports.py           # Protocol seams (consumer-owned)
│       │   ├── thread_id.py       # tenant-scoped helper
│       │   ├── domain/            # types + errors
│       │   ├── nodes/             # IntentRouter, MCPToolCaller, Synthesis, ErrorHandler
│       │   ├── services/          # ChatService, ConversationService
│       │   ├── routes/            # Thin HTTP handlers
│       │   └── streaming/         # DataStreamEncoder
│       └── tests/
│           ├── unit/              # Pure-logic tests
│           ├── component/         # Multiple classes wired, fakes for I/O
│           ├── application/       # create_app(fake_deps) + TestClient
│           ├── integration/       # @pytest.mark.integration; full Docker stack
│           └── fakes/             # Reusable doubles + build_test_dependencies()
├── frontends/
│   └── analytics-dashboard/       # Next.js + Auth0 + Vercel AI SDK
├── tools/
│   ├── data-mcp/                  # Secure SQL MCP
│   ├── salesforce-mcp/            # CRM MCP
│   ├── payments-mcp/              # Payments MCP
│   ├── news-search-mcp/           # News MCP
│   ├── policies/opa/              # Rego policies + tests
│   └── shared/                    # Shared MCP auth + tool_error_boundary
├── platform-sdk/                  # Shared SDK (auth, OPA, cache, resilience, telemetry)
├── platform/
│   ├── db/                        # Init + bankdw/salesforce schema + seed
│   ├── otel/otel-local.yaml       # OTel collector config (debug exporter)
│   └── config/litellm-local.yaml  # LiteLLM model routing
├── tests/                         # Layer-1 unit + integration tests
├── testdata/                      # Synthetic CSVs (CRM + payments)
├── docs/
│   ├── architecture/
│   │   └── agent-reference-pattern.md   # design pattern for new agents
│   ├── DEPLOY.md
│   ├── DEVELOPER_GUIDE.md
│   └── superpowers/
│       ├── specs/                 # design specs
│       └── plans/                 # implementation plans
├── docker-compose.yml             # Single source of truth (dev + cloud)
├── docker-compose.cloud.yml       # Legacy production deploy (revisit pending)
└── Makefile                       # 4 lifecycle targets + help
```

## Troubleshooting

```bash
# Status of every container
docker ps --format "{{.Names}}\t{{.Status}}"

# Logs for the service that looks unhealthy
docker logs ai-analytics-agent
docker logs ai-data-mcp
docker logs ai-otel-collector

# Last resort: clean slate
make setup
```

Common issues:

| Symptom | Likely cause / fix |
|---|---|
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | Another Postgres on the host. Stop it or change the host port mapping in `docker-compose.yml`. |
| `make help` prints "Binary file Makefile matches" | The Makefile got NUL-byte-corrupted on a stale branch. `git checkout main -- Makefile`. |
| No traces in `docker logs ai-otel-collector` | No request has hit the agents yet — see "Verify It Works" above. |
| Dashboard returns 401 | Set `AUTH0_*` in `.env` or use the dev-bypass `X-User-Email` header. |
| Test fixtures missing (no `bankdw.*`/`salesforce.*` schemas) | Postgres init scripts only run on a fresh volume. `make setup` wipes and reloads. |
| `.env` changes not taking effect | Docker reads `.env` only at container `up`. Run `make restart`. |
| `pytest tests/integration/...` fails to connect | Stack not running. Run `make start` (or `make setup`). |

## Further Reading

- [`docs/architecture/agent-reference-pattern.md`](docs/architecture/agent-reference-pattern.md) — the layered SoC/DI pattern that `analytics-agent` follows; reference for new agents
- [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) — adding new agents and MCP servers
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — Azure cloud deployment (note: pending update for the simplified single-compose model)
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design specs (SoC/DI refactor, etc.)
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — implementation plans
- [`platform-sdk/platform_sdk/`](platform-sdk/platform_sdk/) — the shared SDK source
