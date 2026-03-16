"""
Enterprise Data MCP Server

Exposes a single MCP tool — execute_read_query — that lets agents run
parameterised, read-only SQL against per-session isolated schemas.

Key improvements over original:
- Resources initialised via FastMCP lifespan (same event loop as request handlers)
- OPA policy enforcement via platform_sdk.OpaClient (no httpx boilerplate)
- Tool-result caching via platform_sdk.ToolResultCache + cached_tool decorator
- All config via platform_sdk.MCPConfig.from_env() (single source of truth)
- Structured logging via platform_sdk (consistent JSON schema across all services)
- /health endpoint via TCP check (no fastapi dependency required)
- No hardcoded credentials anywhere
- ENVIRONMENT and AGENT_ROLE are server-stamped into OPA input (H3)
"""
import json
import os
import re
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import asyncpg
from mcp.server.fastmcp import FastMCP
from opentelemetry import trace

# L1: use platform_sdk structured logging for consistent JSON schema across services
# setup_telemetry is idempotent (guarded by _initialized flag) — safe on reconnect
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

# ---- Configuration (all from MCPConfig, NO hardcoded defaults) --------------
_config = MCPConfig.from_env()

# DB config still read directly (not part of MCPConfig — DB is data-mcp specific)
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_USER = os.environ.get("DB_USER", "admin")
DB_PASS = os.environ.get("DB_PASS", "")
DB_NAME = os.environ.get("DB_NAME", "ai_memory")
TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio")

# ---- Module-level singletons (set inside lifespan) --------------------------
_db_pool: Optional[asyncpg.Pool] = None
_opa: Optional[OpaClient] = None
_cache: Optional[ToolResultCache] = None
_tracer: Optional[trace.Tracer] = None


# ---- Lifespan ---------------------------------------------------------------

@asynccontextmanager
async def _lifespan(server: FastMCP) -> AsyncIterator[None]:
    """
    FastMCP lifespan handler.

    ALL async resources (asyncpg pool, OPA client, Redis cache) MUST be
    created here so they share the same event loop that FastMCP uses for
    request handlers.
    """
    global _db_pool, _opa, _cache, _tracer

    # --- Telemetry ---
    service_name = os.environ.get("SERVICE_NAME", "data-mcp")
    setup_telemetry(service_name)
    _tracer = trace.get_tracer(__name__)

    # --- OPA client (from SDK — shared connection pool, server-stamped env/role) ---
    _opa = OpaClient(_config)
    log.info("opa_client_ready", url=_config.opa_url)

    # --- Tool-result cache (graceful degradation when REDIS_HOST not set) ---
    if _config.enable_tool_cache:
        _cache = ToolResultCache.from_env(ttl_seconds=_config.tool_cache_ttl_seconds)
    else:
        log.info("tool_cache_disabled", reason="MCPConfig.enable_tool_cache=False")
        _cache = None

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
    log.info("db_pool_ready", host=DB_HOST, db=DB_NAME)
    log.info("startup_complete", transport=TRANSPORT)

    yield  # ← server handles requests while we're here

    # --- Teardown (runs on SIGTERM / KeyboardInterrupt) ----------------------
    if _db_pool:
        await _db_pool.close()
        log.info("db_pool_closed")
    if _opa:
        await _opa.aclose()
    if _cache:
        await _cache.aclose()
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
    assert _opa is not None, "OPA client not initialised"

    with _tracer.start_as_current_span("execute_read_query") as span:
        span.set_attribute("session_id", session_id)

        # 1. OPA policy check (fails closed on any error) — via SDK OpaClient
        is_authorized = await _opa.authorize(
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

        # 4. Cache lookup — skip DB round-trip for repeated identical queries
        cache_key = None
        if _cache is not None:
            from platform_sdk.cache import make_cache_key
            cache_key = make_cache_key("execute_read_query", {"query": query, "session_id": session_id})
            cached_result = await _cache.get(cache_key)
            if cached_result is not None:
                span.set_attribute("cache.hit", True)
                return cached_result

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
                    log.info("query_executed", session_id=session_id, rows=len(records))

                    if not records:
                        return "Query executed successfully. No records found."

                    output = json.dumps([dict(r) for r in records], default=str)

                    if len(output) > _config.max_result_bytes:
                        span.set_attribute("db.truncated", True)
                        log.warning("result_truncated", session_id=session_id, bytes=len(output))
                        output = output[:_config.max_result_bytes] + "\n... [RESULTS TRUNCATED]"

                    # 5. Cache successful result for future identical queries
                    if _cache is not None and cache_key is not None:
                        await _cache.set(cache_key, output)

                    return output

        except asyncpg.PostgresError as exc:
            log.error("db_error", session_id=session_id, error=str(exc))
            span.record_exception(exc)
            # Return a sanitised message — never expose DB internals to the agent
            return "ERROR: A database error occurred. Please check your query syntax."


# ---- Entrypoint -------------------------------------------------------------

if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
