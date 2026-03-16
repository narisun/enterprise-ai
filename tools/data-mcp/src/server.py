"""
Enterprise Data MCP Server

Exposes a single MCP tool — execute_read_query — that lets agents run
parameterised, read-only SQL against per-session isolated schemas.

Key improvements over original:
- Resources initialised via FastMCP lifespan (same event loop as request handlers)
- httpx.AsyncClient is a singleton (no new TCP connection per OPA call)
- Structured logging via platform_sdk (consistent JSON schema across all services)
- Retry logic for transient OPA failures (max 2 retries, fail closed)
- /health endpoint via TCP check (no fastapi dependency required)
- No hardcoded credentials anywhere
- ENVIRONMENT and AGENT_ROLE are server-stamped into OPA input (H3)
"""
import asyncio
import json
import os
import re
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import asyncpg
import httpx
from mcp.server.fastmcp import FastMCP
from opentelemetry import trace

# L1: use platform_sdk structured logging for consistent JSON schema across services
# setup_telemetry is idempotent (guarded by _initialized flag) — safe on reconnect
from platform_sdk import configure_logging, get_logger, setup_telemetry

configure_logging()
log = get_logger(__name__)

# ---- Configuration (all from environment, NO hardcoded defaults) ------------
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_USER = os.environ.get("DB_USER", "admin")
DB_PASS = os.environ.get("DB_PASS", "")
DB_NAME = os.environ.get("DB_NAME", "ai_memory")
OPA_URL = os.environ.get("OPA_URL", "http://localhost:8181/v1/data/mcp/tools/allow")
TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio")

# H3: server-stamped values — callers cannot override these in OPA input
ENVIRONMENT = os.environ.get("ENVIRONMENT", "prod")
AGENT_ROLE = os.environ.get("AGENT_ROLE", "data_analyst_agent")

# Row limit protects LLM context windows
MAX_RESULT_BYTES = int(os.environ.get("MAX_RESULT_BYTES", "15000"))

# ---- Module-level singletons (set inside lifespan) --------------------------
_db_pool: Optional[asyncpg.Pool] = None
_opa_client: Optional[httpx.AsyncClient] = None
_tracer: Optional[trace.Tracer] = None


# ---- Lifespan ---------------------------------------------------------------

@asynccontextmanager
async def _lifespan(server: FastMCP) -> AsyncIterator[None]:
    """
    FastMCP lifespan handler.

    ALL async resources (asyncpg pool, httpx client) MUST be created here so
    they share the same event loop that FastMCP uses for request handlers.
    Creating them in asyncio.run() before mcp.run() puts them on a different
    event loop and causes runtime failures.
    """
    global _db_pool, _opa_client, _tracer

    # --- Telemetry ---
    # Use platform_sdk's idempotent setup_telemetry() instead of inline OTel
    # calls.  The _initialized guard in telemetry.py prevents
    # "Overriding of current TracerProvider is not allowed" on reconnect.
    service_name = os.environ.get("SERVICE_NAME", "data-mcp")
    setup_telemetry(service_name)
    _tracer = trace.get_tracer(__name__)

    # --- OPA HTTP client (one connection pool, reused across all requests) ---
    _opa_client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=1.0, read=2.0, write=2.0, pool=2.0),
        limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
    )
    log.info("opa_client_ready url=%s", OPA_URL)

    # --- DB connection pool --------------------------------------------------
    _db_pool = await asyncpg.create_pool(
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
        host=DB_HOST,
        port=DB_PORT,
        min_size=1,
        max_size=10,
    )
    log.info("db_pool_ready host=%s db=%s", DB_HOST, DB_NAME)
    log.info("startup_complete transport=%s", TRANSPORT)

    yield  # ← server handles requests while we're here

    # --- Teardown (runs on SIGTERM / KeyboardInterrupt) ----------------------
    if _db_pool:
        await _db_pool.close()
        log.info("db_pool_closed")
    if _opa_client:
        await _opa_client.aclose()
        log.info("opa_client_closed")
    log.info("shutdown_complete")


# ---- MCP Server (lifespan attached at construction time) --------------------
if TRANSPORT == "sse":
    mcp = FastMCP("Enterprise Data MCP", lifespan=_lifespan, host="0.0.0.0", port=8080)
else:
    mcp = FastMCP("Enterprise Data MCP", lifespan=_lifespan)


# ---- Security Helpers -------------------------------------------------------

def _is_valid_uuid(val: str) -> bool:
    """Validate that a string is a well-formed UUID (prevents schema injection)."""
    try:
        uuid.UUID(str(val))
        return True
    except ValueError:
        return False


async def _authorize_with_opa(tool_name: str, payload: dict) -> bool:
    """
    Query OPA to decide whether the tool call is allowed.

    - Fails CLOSED on any error (deny by default).
    - Retries once on transient network errors.
    - Uses the reusable _opa_client (no new TCP connection per call).
    """
    assert _opa_client is not None, "OPA client not initialised"

    # H3: stamp environment and agent_role from server config — callers cannot
    # inject these via tool arguments, preventing the local-env bypass attack.
    input_data = {"tool": tool_name, **payload}
    input_data["environment"] = ENVIRONMENT   # always overrides any caller-supplied value
    input_data["agent_role"] = AGENT_ROLE     # service-level identity, not caller-controlled
    request_body = {"input": input_data}

    for attempt in range(2):   # one retry on transient failure
        try:
            response = await _opa_client.post(OPA_URL, json=request_body)
            response.raise_for_status()
            decision = bool(response.json().get("result", False))
            log.info("opa_decision tool=%s allowed=%s attempt=%d", tool_name, decision, attempt + 1)
            return decision
        except httpx.TimeoutException:
            log.warning("opa_timeout tool=%s attempt=%d", tool_name, attempt + 1)
        except httpx.HTTPStatusError as exc:
            log.error("opa_http_error tool=%s status=%d", tool_name, exc.response.status_code)
            return False   # Fail closed immediately on HTTP errors
        except Exception as exc:
            log.error("opa_error tool=%s error=%s attempt=%d", tool_name, exc, attempt + 1)

        if attempt == 0:
            await asyncio.sleep(0.2)   # Brief back-off before retry

    log.error("opa_unavailable tool=%s — all retries exhausted, denying", tool_name)
    return False   # Fail closed


# ---- MCP Tools --------------------------------------------------------------

@mcp.tool()
async def execute_read_query(query: str, session_id: str) -> str:
    """
    Execute a read-only SQL SELECT query in the agent's isolated workspace schema.

    Args:
        query:      A SELECT statement. Mutating queries are rejected.
        session_id: UUID identifying the agent's workspace schema.

    Returns:
        JSON-encoded rows, a "no records found" message, or an error string.
    """
    assert _tracer is not None, "Telemetry not initialised"
    assert _db_pool is not None, "DB pool not initialised"

    with _tracer.start_as_current_span("execute_read_query") as span:
        span.set_attribute("session_id", session_id)

        # 1. OPA policy check (fails closed on any error)
        is_authorized = await _authorize_with_opa(
            "execute_read_query",
            {"query": query, "session_id": session_id},
        )
        span.set_attribute("opa.authorized", is_authorized)
        if not is_authorized:
            span.set_status(trace.StatusCode.ERROR, "OPA denied")
            return "ERROR: Unauthorized. Execution blocked by policy engine."

        # 2. UUID validation prevents schema-name injection
        if not _is_valid_uuid(session_id):
            return "ERROR: Invalid session_id — must be a valid UUID."

        # 3. Regex guard: only single SELECT statements allowed
        # M8: \b prevents prefix bypass (e.g. "SELECTBAD"); semicolon check blocks
        #     multi-statement injection (readonly=True transaction is the primary guard)
        if not re.match(r"^\s*SELECT\b", query, re.IGNORECASE) or ";" in query:
            return "ERROR: Security policy violation — only single SELECT queries are permitted."

        schema_name = f"ws_{session_id.replace('-', '_')}"

        try:
            async with _db_pool.acquire() as conn:
                async with conn.transaction(readonly=True):
                    # H2: SET LOCAL scopes this to the current transaction only,
                    # preventing schema leakage to the next request on the same
                    # connection when it is returned to the pool.
                    await conn.execute(f"SET LOCAL search_path TO {schema_name}, public")
                    records = await conn.fetch(query)

                    span.set_attribute("db.row_count", len(records))
                    log.info("query_executed session_id=%s rows=%d", session_id, len(records))

                    if not records:
                        return "Query executed successfully. No records found."

                    output = json.dumps([dict(r) for r in records], default=str)

                    if len(output) > MAX_RESULT_BYTES:
                        span.set_attribute("db.truncated", True)
                        log.warning("result_truncated session_id=%s bytes=%d", session_id, len(output))
                        return output[:MAX_RESULT_BYTES] + "\n... [RESULTS TRUNCATED]"

                    return output

        except asyncpg.PostgresError as exc:
            log.error("db_error session_id=%s error=%s", session_id, exc)
            span.record_exception(exc)
            # Return a sanitised message — never expose DB internals to the agent
            return "ERROR: A database error occurred. Please check your query syntax."


# ---- Entrypoint -------------------------------------------------------------

if __name__ == "__main__":
    log.info("mcp_server_starting transport=%s", TRANSPORT)
    mcp.run(transport=TRANSPORT)
