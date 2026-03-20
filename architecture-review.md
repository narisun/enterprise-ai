# Enterprise AI Platform — Architecture Review

**Reviewer:** Software Architect / Agentic AI Specialist
**Date:** March 20, 2026
**Scope:** Separation of concerns, security, testability, maintainability, and framework-specific best practices

---

## Executive Summary

This is a well-architected enterprise agentic AI platform with strong foundations: a reusable platform SDK, OPA-based policy enforcement, HMAC-signed inter-service context propagation, structured logging, and a layered test pyramid (unit → integration → LLM evals). The codebase demonstrates mature security thinking (fail-closed OPA, column/row masking, server-stamped environment claims) and good separation between orchestration, tools, and presentation.

That said, the review surfaced **31 findings** across 5 categories. Most are medium-severity improvements that will harden the system for production scale. The high-severity findings center on mutable global state in MCP servers, secret handling at module load time, and missing input validation on SQL schema names.

---

## 1. Separation of Concerns

### 1.1 HIGH — Mutable Module-Level Globals in MCP Servers

**Files:** `tools/data-mcp/src/server.py` (lines 55-58), `tools/payments-mcp/src/server.py` (lines 43-45), `tools/salesforce-mcp/src/server.py` (similar)

All four MCP servers use `global` declarations inside the lifespan to mutate module-level singletons:

```python
_db_pool: Optional[asyncpg.Pool] = None
_opa: Optional[OpaClient] = None
_cache: Optional[ToolResultCache] = None

async def _lifespan(server: FastMCP):
    global _db_pool, _opa, _cache
    ...
```

**Problems:**
- Breaks testability — you cannot run two server instances in the same process with different configs (e.g., parallel pytest-xdist workers).
- Violates the dependency-inversion principle — tool functions reach into module scope for their dependencies instead of receiving them.
- Race condition risk if the server is ever instantiated twice (e.g., during hot-reload in dev).

**Recommendation:** Use FastMCP's lifespan context or a dependency-injection pattern. Store resources in a `ServerContext` dataclass that the lifespan yields and tool functions receive:

```python
@dataclasses.dataclass
class ServerContext:
    db_pool: asyncpg.Pool
    opa: OpaClient
    cache: Optional[ToolResultCache]

@asynccontextmanager
async def _lifespan(server: FastMCP) -> AsyncIterator[ServerContext]:
    pool = await asyncpg.create_pool(...)
    opa = OpaClient(_config)
    cache = ToolResultCache.from_env(...)
    yield ServerContext(pool, opa, cache)
    await pool.close()
    await opa.aclose()
```

If FastMCP doesn't support yielding a context (check the version), use `server.state` or a ContextVar scoped to the server instance.

---

### 1.2 MEDIUM — Duplicated MCP Bridge Code Across Services

**Files:** `agents/src/mcp_bridge.py` (362 lines), `agents/rm-prep/Dockerfile` (line copying mcp_bridge.py)

The rm-prep Dockerfile copies `mcp_bridge.py` from the main agents service:

```dockerfile
COPY agents/src/mcp_bridge.py /app/src/mcp_bridge.py
```

This creates a second copy that can drift from the original. If a security fix is applied to one copy, it may be missed in the other.

**Recommendation:** Move `MCPToolBridge` into `platform-sdk` as a first-class module (e.g., `platform_sdk.mcp_bridge`). Both services then import from the same installed package. The bridge is already a generic, reusable component — it has no service-specific logic.

---

### 1.3 MEDIUM — Test Persona Definitions Duplicated in 3 Places

**Files:** `agents/rm-prep/src/server.py` (_TEST_PERSONAS), `tests/conftest.py`, `tests/integration/conftest.py`

Persona definitions (role, account IDs, clearance) are duplicated across the server code and two test conftest files. If a new persona is added or account IDs change, all three must be updated in lockstep.

**Recommendation:** Define a single `TEST_PERSONAS` dict in `platform_sdk.testing` (or a shared test fixtures module) and import it everywhere. The server module can conditionally import it only when `_is_dev_env()` is true.

---

### 1.4 MEDIUM — Payments Tool Contains Both Authorization AND Business Logic

**File:** `tools/payments-mcp/src/server.py` — `get_payment_summary()` (lines 369-469)

The public tool function handles OPA authorization, agent context extraction, column masking, row filtering, caching, AND delegates to the implementation. This is a ~100-line function mixing cross-cutting concerns with business logic.

**Recommendation:** Extract a reusable `authorized_tool` decorator or middleware pattern (similar to how `cached_tool` works) that handles OPA + AgentContext + column masking before the tool body executes. This would reduce each tool to its core business logic and make the authorization flow consistent and testable in isolation.

---

## 2. Security

### 2.1 HIGH — JWT_SECRET Read at Module Import Time, Not at Verification Time

**File:** `platform-sdk/platform_sdk/auth.py` (lines 36-44)

```python
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-prod")
_CONTEXT_HMAC_SECRET: bytes = os.environ.get("CONTEXT_HMAC_SECRET", JWT_SECRET).encode()
```

Both secrets are captured as module-level constants when the module is first imported. This means:
- If the environment variable is set *after* import (e.g., in a test `monkeypatch` or late Docker Compose interpolation), the old value is used.
- The default `"dev-secret-change-in-prod"` is baked in for the entire process lifetime even if the env var is later corrected.
- `_CONTEXT_HMAC_SECRET` defaults to `JWT_SECRET`, which the docstring says should be a *separate* secret — but the default coupling makes it easy to forget.

**Recommendation:** Read secrets lazily at verification time (inside `from_jwt()` and `_sign()`), or provide a `configure(jwt_secret, hmac_secret)` function that services must call during startup, failing fast if either is missing. The `_assert_secrets()` pattern used by payments-mcp is good but should be centralized in the SDK.

---

### 2.2 HIGH — SQL Schema Name Not Parameterized

**File:** `tools/data-mcp/src/server.py` (line 205)

```python
await conn.execute(f"SET LOCAL search_path TO {schema_name}, public")
```

While `schema_name` is validated as a UUID, the f-string interpolation into SQL is a code smell. If the UUID validation (`_is_valid_uuid`) is ever bypassed or weakened, this becomes a direct SQL injection vector. PostgreSQL `SET LOCAL search_path` does not support `$1`-style parameterization, so this is a known limitation.

**Recommendation:** Add an additional safeguard — use `asyncpg`'s `quote_ident()` or manually double-quote the identifier:

```python
safe_schema = f'"{schema_name}"'  # PostgreSQL identifier quoting
await conn.execute(f"SET LOCAL search_path TO {safe_schema}, public")
```

Also, consider adding a regex check that the schema name matches `^ws_[0-9a-f_]+$` in addition to the UUID check, as defense in depth.

---

### 2.3 MEDIUM — API Key Comparison Uses String Equality, Not Constant-Time Compare

**File:** `platform-sdk/platform_sdk/security.py` (line 185)

```python
if credentials.credentials != key:
```

The HMAC verification in `auth.py` correctly uses `hmac.compare_digest()`, but the API key verifier uses plain string comparison. This is vulnerable to timing attacks in theory, though the practical risk depends on network jitter.

**Recommendation:** Use `hmac.compare_digest(credentials.credentials, key)` for consistency and defense in depth.

---

### 2.4 MEDIUM — Error Responses Leak Internal Details in Payments MCP

**File:** `tools/payments-mcp/src/server.py` (lines 448-463)

```python
return f"ERROR: Database error ({type(exc).__name__}): {exc}"
return f"ERROR: Database interface error ({type(exc).__name__}): {exc}"
return f"ERROR: Unexpected error in payment summary ({type(exc).__name__}): {exc}"
```

Exception messages from asyncpg can contain table names, column names, schema paths, and connection details. These are returned to the LLM agent, which may include them in user-facing responses.

**Recommendation:** Return generic error messages to the tool caller (as data-mcp already does: `"ERROR: A database error occurred."`), and log the full exception details server-side. The LLM doesn't need stack traces to reason about failures.

---

### 2.5 MEDIUM — No Rate Limiting on Auth Token Endpoint

**File:** `agents/rm-prep/src/server.py` — `/auth/token` endpoint

The test token endpoint issues signed JWTs for any persona without rate limiting. While it's behind `_require_dev_env()`, a misconfigured `ENVIRONMENT` variable in a staging deployment could expose it. A brute-force attack could generate unlimited tokens.

**Recommendation:** Add a rate limiter (e.g., `slowapi` or a simple in-memory counter) and add a startup log warning if `_is_dev_env()` is true and `JWT_SECRET` is not the default. Consider requiring an additional confirmation env var (e.g., `ENABLE_TEST_AUTH=true`) beyond just `ENVIRONMENT`.

---

### 2.6 LOW — `.env` File Contains Real API Keys

**File:** `.env` (present in repo root)

The `.env` file is in `.gitignore`, which is good. However, the `.env` file in the working directory contains what appear to be real Azure OpenAI API keys, AWS credentials, and a Tavily API key. If this repo is ever cloned to a shared system or included in a Docker image by mistake, these credentials are exposed.

**Recommendation:** Ensure CI never mounts the real `.env`. Consider using a secrets manager (AWS Secrets Manager, Vault) for production, and document in the README that `.env` must never be committed.

---

## 3. Testability

### 3.1 HIGH — No Unit Tests for MCP Tool Business Logic in Payments/Salesforce/News

**Files:** `tools/payments-mcp/`, `tools/salesforce-mcp/`, `tools/news-search-mcp/`

Only `data-mcp` has a dedicated `tests/test_server.py`. The other three MCP servers have no unit tests for their core business logic. The integration tests cover end-to-end flows, but individual functions like `_get_payment_summary_impl()`, `_apply_col_mask()`, and the aggregation logic are untested in isolation.

**Recommendation:** Add unit tests for:
- `_apply_col_mask()` — verify correct nulling of columns per clearance level
- `_get_payment_summary_impl()` — mock the asyncpg pool and verify SQL parameter binding, aggregation math, and truncation logic
- `get_salesforce_summary` — verify ILIKE fuzzy match logic, PII masking, and ambiguous result handling
- News search mock data fuzzy matching and signal classification

---

### 3.2 MEDIUM — Global State Makes MCP Server Tests Require Monkeypatching

Because MCP tool functions read from module-level globals (`_db_pool`, `_opa`, `_cache`), tests must either: (a) monkeypatch these globals, (b) run the full server with lifespan, or (c) use integration tests. This makes fast, isolated unit testing difficult.

**Recommendation:** Resolving finding 1.1 (dependency injection) would also fix this — tool functions would receive their dependencies as parameters, making them trivially testable with mock objects.

---

### 3.3 MEDIUM — No Negative Tests for MCP Bridge Reconnection / Disconnection

**File:** `agents/src/mcp_bridge.py`

The bridge has sophisticated connection lifecycle management (background tasks, Event-based signaling, retry logic), but `agents/tests/test_graph.py` only tests agent building, not the bridge itself. There are no tests for:
- Connection failure after all retries exhausted
- Disconnect during an active tool call
- Reconnection after a network partition
- Concurrent `get_langchain_tools()` calls

**Recommendation:** Add a mock MCP server (using `FastMCP` in stdio mode) and test the full connect → tool-call → disconnect lifecycle, including failure paths.

---

### 3.4 LOW — Eval Tests Depend on Live LLM Responses Without Deterministic Seeds

**Files:** `tests/evals/test_synthesis_quality.py`, `tests/evals/test_faithfulness.py`

LLM eval tests call real models via LiteLLM. Results are non-deterministic, which can cause flaky CI. The `ci-evals.yml` workflow has a 45-minute timeout, suggesting runs can be slow.

**Recommendation:** For the eval layer, consider caching LLM responses (the `brief_runner` fixture partially does this) and adding a `--snapshot` mode that saves responses for replay. For CI stability, pin the model version in the LiteLLM config and use temperature=0 (already the case for agents, but verify for the judge LLM).

---

## 4. Maintainability

### 4.1 HIGH — `cached_tool(None)` Unused Decorator in Payments MCP

**File:** `tools/payments-mcp/src/server.py` (line 361)

```python
@cached_tool(None)  # cache applied manually below after OPA + mask decisions
async def _get_payment_summary_cached(client_name: str, days: int, col_mask_key: str) -> str:
```

This function is decorated with `@cached_tool(None)`, which is a no-op (the decorator passes through when cache is None). But this function is also never called — the actual tool function calls `_get_payment_summary_impl()` directly. This is dead code that confuses the caching story.

**Recommendation:** Remove `_get_payment_summary_cached` entirely. The manual cache get/set in `get_payment_summary()` is the actual caching path and is correct.

---

### 4.2 MEDIUM — Jinja2 Templates with `autoescape=False` and `{{ }}` Literal Passthrough

**File:** `agents/rm-prep/src/graph.py` (lines 44, 346-348)

```python
_jinja_env = Environment(loader=FileSystemLoader(str(_PROMPT_DIR)), autoescape=False)
...
crm_prompt = _load_prompt("crm_specialist.j2", client_name="{{ client_name }}")
```

Passing `"{{ client_name }}"` as a Jinja2 variable renders the literal string `{{ client_name }}` into the prompt. This is not an injection risk (the rendered prompt is sent to the LLM, not a browser), but it's confusing — it looks like a Jinja2 variable that should be resolved but isn't.

**Recommendation:** If the intent is to include a placeholder in the rendered prompt, use a non-Jinja2 marker (e.g., `{client_name}` or `__CLIENT_NAME__`) to avoid confusion. Document the distinction clearly: Jinja2 variables are resolved at graph-build time; placeholder tokens are resolved by the LLM at runtime.

---

### 4.3 MEDIUM — `asyncio.get_event_loop()` Deprecated in Python 3.12+

**File:** `agents/src/mcp_bridge.py` (line 285)

```python
self._bg_task = asyncio.get_event_loop().create_task(_connection_task())
```

`asyncio.get_event_loop()` emits a `DeprecationWarning` in Python 3.12+ when no running loop exists. While this code likely runs inside an async context (where a loop exists), it's fragile.

**Recommendation:** Use `asyncio.get_running_loop().create_task(...)` instead. This is both correct and explicit about requiring a running loop.

---

### 4.4 MEDIUM — No Type Stubs or mypy Configuration

The project has `ruff` for linting but no `mypy` or `pyright` configuration. Several files use `Optional` patterns, dynamic Pydantic model creation, and `dict` typings that would benefit from static analysis.

**Recommendation:** Add `mypy.ini` or `pyproject.toml [tool.mypy]` section with at least `--warn-return-any --warn-unused-ignores`. Start with `--ignore-missing-imports` and progressively tighten.

---

### 4.5 MEDIUM — Inconsistent Error Return Convention Across MCP Tools

MCP tools return error strings in two different formats:
- `"ERROR: ..."` prefix (data-mcp, payments-mcp)
- `json.dumps({"error": "...", "message": "..."})` (payments-mcp for no-data, salesforce-mcp)

The `cached_tool` decorator checks for `result.startswith("ERROR:")` to skip caching, but JSON error responses will be cached.

**Recommendation:** Standardize on a single error format. A good pattern is to always return JSON with an `"error"` key, and update `cached_tool` to check for `"error"` in the parsed JSON. This also makes downstream error handling in the orchestrator consistent.

---

### 4.6 MEDIUM — MemorySaver Used Unconditionally in RM Orchestrator

**File:** `agents/rm-prep/src/graph.py` (line 299)

```python
checkpointer = MemorySaver()
return builder.compile(checkpointer=checkpointer)
```

`AgentConfig` has `checkpointer_type` and `checkpointer_db_url` fields supporting both `"memory"` and `"postgres"` backends, but the RM orchestrator always uses `MemorySaver()`, ignoring the config.

**Recommendation:** Read `config.checkpointer_type` and construct the appropriate checkpointer. For production deployments with multiple replicas, `MemorySaver` loses state when requests hit different pods.

---

### 4.7 LOW — Requirements Files Use `>=` Without Upper Bounds

**Files:** All `requirements.txt` across agents/, tools/

```
langgraph>=0.2.0
langchain-openai>=0.1.8
fastapi>=0.111.0
```

Open-ended version ranges mean a `pip install` tomorrow could pull a breaking LangGraph 1.0 release.

**Recommendation:** Pin to compatible ranges: `langgraph>=0.2.0,<0.3.0` or use a lockfile (`pip-compile` / `uv.lock`). The `platform-sdk/pyproject.toml` already sets ranges — extend this discipline to all services.

---

### 4.8 LOW — No Health Check Depth Beyond `{"status": "ok"}`

**Files:** All server.py files with `/health` endpoints

Health probes return `{"status": "ok"}` without checking downstream dependencies (database pool, Redis, OPA). A service can report healthy while its database connection pool is exhausted.

**Recommendation:** Add a `/health/ready` endpoint that pings the DB pool, Redis, and OPA (with short timeouts). Use this for Kubernetes readiness probes while keeping the shallow `/health` for liveness probes.

---

## 5. Framework-Specific Issues

### 5.1 HIGH — LangGraph: Parallel Nodes Without Reducers on `error_states`

**File:** `agents/rm-prep/src/state.py`

```python
class RMPrepState(TypedDict):
    error_states: Annotated[dict, _merge_errors]
```

The `_merge_errors` reducer is correctly defined for `error_states`, which is good. However, `gather_payments` and `gather_news` run in parallel and both return `payments_output` / `news_output` respectively. Since each parallel branch only writes its own output key, there's no conflict. But if a future refactor causes two parallel nodes to write the same key, LangGraph will raise `InvalidUpdateError` at runtime with no compile-time warning.

**Recommendation:** Add a code comment documenting this invariant. Consider adding a CI check that verifies no two parallel-branch nodes return overlapping state keys (a simple static analysis on the node factory return dicts).

---

### 5.2 MEDIUM — LangGraph: `astream_events` Version "v2" Dual-Fire on `on_chain_end`

**File:** `agents/rm-prep/src/server.py` (lines 293-301)

```python
elif event_type == "on_chain_end" and node_name == "synthesize":
    output = event.get("data", {}).get("output", {})
    if isinstance(output, dict):  # filter out the inner chain event
```

The code correctly handles the LangGraph v2 dual-fire behavior for `on_chain_end` (inner `with_structured_output` chain vs. outer node), but this is fragile. A LangGraph version upgrade could change the event structure.

**Recommendation:** Pin `langgraph` to a specific minor version range and add a regression test that asserts the event structure from `astream_events` for the synthesize node.

---

### 5.3 MEDIUM — asyncpg: Pool Created Without `statement_cache_size` Configuration

**Files:** All services using `asyncpg.create_pool()`

If the platform ever introduces pgBouncer or another connection pooler (common in Kubernetes deployments), the default prepared statement cache will break with errors like `"__asyncpg_stmt_xx__ does not exist"`.

**Recommendation:** Add `statement_cache_size=0` as a configurable option in `MCPConfig` for pgBouncer compatibility, defaulting to the asyncpg default (1024) for direct connections. Document the pgBouncer configuration requirement.

---

### 5.4 MEDIUM — FastAPI: Sync `_assert_secrets()` in Async Lifespan

**File:** `tools/payments-mcp/src/server.py` (line 79)

`_assert_secrets()` calls `sys.exit(1)` inside an async context manager. While this works, `sys.exit()` raises `SystemExit`, which is caught differently by different ASGI servers (uvicorn, hypercorn). Some may log a confusing traceback.

**Recommendation:** Raise a custom exception or call `os._exit(1)` (for immediate termination without cleanup), or better yet, validate secrets before starting uvicorn (in a `__main__` guard or startup script).

---

### 5.5 MEDIUM — OpenTelemetry: Context Propagation May Break Across `asyncio.create_task()`

**File:** `agents/src/mcp_bridge.py` (line 285)

```python
self._bg_task = asyncio.get_event_loop().create_task(_connection_task())
```

OpenTelemetry trace context may not propagate into tasks created with `create_task()`. The bridge's background task will create orphaned root spans instead of child spans of the calling trace.

**Recommendation:** Capture the current context and pass it explicitly:

```python
import opentelemetry.context as otel_context

ctx = otel_context.get_current()
self._bg_task = asyncio.get_running_loop().create_task(
    _connection_task(), context=ctx
)
```

---

### 5.6 LOW — Pydantic: `RMBrief` Uses `list[str]` for Structured Fields

**File:** `agents/rm-prep/src/brief.py`

Fields like `talking_points: list[str]` and `sources: list[str]` are untyped string lists. If the LLM returns unexpected content (e.g., nested objects), Pydantic v2 will coerce them to strings silently rather than raising a validation error.

**Recommendation:** Consider using `list[constr(min_length=1, max_length=500)]` to constrain individual items, or use a custom validator that rejects non-string items.

---

### 5.7 LOW — Redis: No Connection Health Check on Cache Miss

**File:** `platform-sdk/platform_sdk/cache.py`

The cache gracefully degrades on errors (good), but there's no mechanism to detect when Redis recovers after an outage. If Redis goes down and comes back, the cache continues to log warnings on every request without attempting a reconnection.

**Recommendation:** Add a periodic health check (e.g., `PING` every 30 seconds) or implement a circuit-breaker pattern that temporarily disables cache attempts after N consecutive failures, then retries after a cooldown.

---

## 6. Summary of Recommendations by Priority

| Priority | Count | Key Actions |
|----------|-------|-------------|
| **HIGH** | 5 | Eliminate mutable globals in MCP servers; lazy-load secrets; add SQL identifier quoting; add unit tests for payments/salesforce/news tools; remove dead cached code |
| **MEDIUM** | 16 | Extract MCP bridge to SDK; centralize personas; add `authorized_tool` decorator; use constant-time API key comparison; sanitize error messages; add mypy; standardize error format; fix asyncio deprecated API; configure statement_cache_size; add readiness probes |
| **LOW** | 7 | Pin dependency versions; add Redis circuit breaker; constrain Pydantic fields; add .env safeguards |

---

## 7. What's Done Well

To be clear, this platform has several architectural strengths that should be preserved:

- **Platform SDK as a shared library** — Centralizing auth, caching, OPA, logging, config, and agent factories prevents copy-paste drift and enforces consistency.
- **HMAC-signed X-Agent-Context** — Defense-in-depth: JWT compromise alone cannot forge MCP context headers.
- **Server-stamped OPA claims** — Environment and agent_role are overwritten server-side, preventing client escalation.
- **Fail-closed OPA** — All retries exhausted → deny. This is the correct enterprise default.
- **Generator-Evaluator loop** in portfolio-watch — A well-implemented self-critique pattern with iteration caps.
- **Three-layer test pyramid** — Unit, integration, and LLM evals with adaptive thresholds and RAGAS faithfulness scoring.
- **Model tiering** — Using Haiku for routing/specialists and Sonnet for synthesis is cost-effective and architecturally sound.
- **Graceful cache degradation** — Redis unavailable → no-op. Tool execution never blocks on cache failures.
- **Structured logging** — Consistent JSON schema across all services via structlog.
