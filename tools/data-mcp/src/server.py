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
from contextvars import ContextVar
from dataclasses import dataclass
from typing import AsyncIterator, Optional

import asyncpg
from mcp.server.fastmcp import FastMCP
from opentelemetry import trace

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
from platform_sdk.protocols import Authorizer, CacheStore

configure_logging()
log = get_logger(__name__)

# ---- Configuration (all from MCPConfig, NO hardcoded defaults) --------------

# TRANSPORT is read at module level because FastMCP construction requires it at import time
# (before lifespan runs). This cannot be deferred to the lifespan function.
TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio")

# ---- ServerContext (replaces module-level globals) ----------------------------

@dataclass(frozen=True)
class ServerContext:
    """All runtime dependencies, created once in lifespan."""
    opa: Authorizer
    cache: Optional[CacheStore]
    db_pool: asyncpg.Pool
    tracer: trace.Tracer
    config: MCPConfig

_ctx: ContextVar[ServerContext] = ContextVar("data_mcp_ctx")


# ---- Lifespan ---------------------------------------------------------------

@asynccontextmanager
async def _lifespan(server: FastMCP) -> AsyncIterator[None]:
    """
    FastMCP lifespan handler.

    ALL async resources (asyncpg pool, OPA client, Redis cache) MUST be
    created here so they share the same event loop that FastMCP uses for
    request handlers.
    """
    # --- Configuration ---
    config = MCPConfig.from_env()

    # --- Telemetry ---
    setup_telemetry(config.service_name)
    tracer = trace.get_tracer(__name__)

    # --- OPA client (from SDK — shared connection pool, server-stamped env/role) ---
    opa = OpaClient(config)
    log.info("opa_client_ready", url=config.opa_url)

    # --- Tool-result cache (graceful degradation when REDIS_HOST not set) ---
    cache: Optional[CacheStore] = None
    if config.enable_tool_cache:
        cache = ToolResultCache.from_config(config, ttl_seconds=config.tool_cache_ttl_seconds)
    else:
        log.info("tool_cache_disabled", reason="MCPConfig.enable_tool_cache=False")

    # --- DB connection pool --------------------------------------------------
    db_pool = await asyncpg.create_pool(
        user=config.db_user,
        password=config.db_pass,
        database=config.db_name,
        host=config.db_host,
        port=config.db_port,
        min_size=1,
        max_size=10,
        statement_cache_size=config.statement_cache_size,
        ssl="require" if config.db_require_ssl else None,
    )
    log.info("db_pool_ready", host=config.db_host, db=config.db_name)

    ctx = ServerContext(opa=opa, cache=cache, db_pool=db_pool, tracer=tracer, config=config)
    token = _ctx.set(ctx)
    log.info("startup_complete", transport=TRANSPORT)

    yield  # ← server handles requests while we're here

    # --- Teardown (runs on SIGTERM / KeyboardInterrupt) ----------------------
    _ctx.reset(token)
    await db_pool.close()
    log.info("db_pool_closed")
    await opa.aclose()
    if cache:
        await cache.aclose()
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
    Execute a read-only SQL SELECT query against the enterprise database.

    Args:
        query:      A SELECT statement. Only SELECT queries are permitted;
                    mutating statements are rejected.
        session_id: Workspace session UUID — injected automatically by the
                    agent runtime.  Pass any non-empty string; the correct
                    value is always supplied by the server.

    Returns:
        JSON-encoded rows, a "no records found" message, or an error string.
    """
    ctx = _ctx.get()

    with ctx.tracer.start_as_current_span("execute_read_query") as span:
        span.set_attribute("session_id", session_id)

        # 1. OPA policy check (fails closed on any error) — via SDK OpaClient
        is_authorized = await ctx.opa.authorize(
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
        # Strip a trailing semicolon first — standard SQL practice, not an injection.
        # The embedded-semicolon check below catches actual multi-statement attempts
        # (e.g. "SELECT 1; DROP TABLE users").
        # \b prevents prefix bypass (e.g. "SELECTBAD"); readonly=True transaction
        # is the primary DB-level guard against mutation.
        query = query.rstrip().rstrip(";").rstrip()
        if not re.match(r"^\s*SELECT\b", query, re.IGNORECASE) or ";" in query:
            return "ERROR: Security policy violation — only single SELECT queries are permitted."

        # 4. Cache lookup — skip DB round-trip for repeated identical queries
        cache_key = None
        if ctx.cache is not None:
            from platform_sdk.cache import make_cache_key
            cache_key = make_cache_key("execute_read_query", {"query": query, "session_id": session_id})
            cached_result = await ctx.cache.get(cache_key)
            if cached_result is not None:
                span.set_attribute("cache.hit", True)
                return cached_result

        schema_name = f"ws_{session_id.replace('-', '_')}"

        # Defence in depth: verify the schema name matches the expected pattern
        # before interpolating it into SQL.  The UUID check above should prevent
        # anything unexpected, but this regex is a second safety net.
        if not re.fullmatch(r"ws_[0-9a-f_]+", schema_name):
            return "ERROR: Invalid session_id format — cannot construct schema name."

        try:
            async with ctx.db_pool.acquire() as conn:
                async with conn.transaction(readonly=True):
                    # SET LOCAL scopes this to the current transaction only,
                    # preventing schema leakage to the next request on the same
                    # connection when it is returned to the pool.
                    # statement_timeout prevents long-running or sleep() queries from
                    # holding a connection indefinitely (e.g. SELECT pg_sleep(300)).
                    # Schema name is double-quoted as a PostgreSQL identifier for safety.
                    safe_schema = f'"{schema_name}"'
                    await conn.execute(f"SET LOCAL search_path TO {safe_schema}, public")
                    await conn.execute("SET LOCAL statement_timeout = '30s'")
                    records = await conn.fetch(query)

                    span.set_attribute("db.row_count", len(records))
                    log.info("query_executed", session_id=session_id, rows=len(records))

                    if not records:
                        return "Query executed successfully. No records found."

                    output = json.dumps([dict(r) for r in records], default=str)

                    if len(output) > ctx.config.max_result_bytes:
                        span.set_attribute("db.truncated", True)
                        log.warning("result_truncated", session_id=session_id, bytes=len(output))
                        output = output[:ctx.config.max_result_bytes] + "\n... [RESULTS TRUNCATED]"

                    # 5. Cache successful result for future identical queries
                    if ctx.cache is not None and cache_key is not None:
                        await ctx.cache.set(cache_key, output)

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
