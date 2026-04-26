"""MCP service layer for data query execution with OPA authorization and caching.

Extends McpService to handle:
- Tool registration with @mcp.tool() decorator
- OPA authorization checks
- Result caching with TTL
- Delegation to DataQueryService for business logic
"""
import json
import os
from typing import Any, Optional

import asyncpg
from opentelemetry import trace

from platform_sdk import MCPConfig, configure_logging, get_logger, make_error, setup_telemetry
from platform_sdk.base import McpService
from platform_sdk.cache import make_cache_key
from platform_sdk.protocols import Authorizer, CacheStore
from platform_sdk.schema_introspection import format_for_prompt, introspect_schema
from tools_shared.mcp_auth import verify_auth_context

from .data_query_service import DataQueryService

configure_logging()
log = get_logger(__name__)


class DataMcpService(McpService):
    """MCP service for data query execution with authorization and caching."""

    cache_ttl_seconds = 300  # 5 minutes
    requires_database = True
    enable_telemetry = True

    def __init__(
        self,
        name: str = "data-mcp",
        *,
        config: Optional[MCPConfig] = None,
        authorizer: Optional[Authorizer] = None,
        cache: Optional[CacheStore] = None,
        db_pool: Optional[asyncpg.Pool] = None,
    ) -> None:
        """
        Initialize the data MCP service.

        Args:
            name: Service name (default: "data-mcp").
            config: Optional MCPConfig to inject.
            authorizer: Optional Authorizer to inject.
            cache: Optional CacheStore to inject.
            db_pool: Optional asyncpg.Pool to inject (for testing).
        """
        super().__init__(name, config=config, authorizer=authorizer, cache=cache, db_pool=db_pool)
        self.tracer: Optional[trace.Tracer] = None
        self.data_service: Optional[DataQueryService] = None

    async def on_startup(self) -> None:
        """Initialize the OTel tracer and DataQueryService during startup."""
        self.tracer = trace.get_tracer(__name__)

        self.data_service = DataQueryService(
            db_pool=self._db_pool,
            tracer=self.tracer,
            max_result_bytes=self.mcp_config.max_result_bytes,
        )
        log.info("data_mcp_ready")

    def register_tools(self, mcp: Any) -> None:
        """
        Register the execute_read_query tool with the MCP server.

        Args:
            mcp: The FastMCP server instance.
        """
        # Capture self for lazy access in closures — properties like
        # self._authorizer, self._cache, and self.data_service are only
        # available after the lifespan runs, NOT at registration time.
        svc = self

        @mcp.tool()
        async def execute_read_query(query: str, session_id: str, auth_context: str = "") -> str:
            """
            Execute a read-only SQL SELECT query against the enterprise database.

            Args:
                query: A SELECT statement. Only SELECT queries are permitted;
                       mutating statements are rejected.
                session_id: Workspace session UUID — injected automatically by the
                           agent runtime. Pass any non-empty string; the correct
                           value is always supplied by the server.
                auth_context: HMAC-signed auth token (system-injected, do not set).

            Returns:
                JSON-encoded rows, a "no records found" message, or an error string.
            """
            # Input validation
            if not query or not query.strip():
                return make_error("invalid_input", "query must not be empty.")
            if not session_id or not session_id.strip():
                return make_error("invalid_input", "session_id must not be empty.")

            query = query.strip()
            session_id = session_id.strip()

            # Extract verified user identity from HMAC-signed auth context
            user_ctx = verify_auth_context(auth_context)

            # OPA authorization (resolved at request time)
            is_authorized = await svc.authorizer.authorize(
                "execute_read_query",
                {"query": query, "session_id": session_id, "user_role": user_ctx.user_role},
            )
            if not is_authorized:
                log.warning("opa_denied", tool="execute_read_query")
                return make_error("unauthorized", "Execution blocked by policy engine.")

            # Cache lookup. user_role is part of the key so role-masked
            # rows from one role can't bleed into a request from a less
            # privileged role (the same query may return different
            # columns depending on caller clearance).
            cache_key = None
            cache = svc._cache
            if cache is not None:
                cache_key = make_cache_key(
                    "execute_read_query",
                    {
                        "query": query,
                        "session_id": session_id,
                        "user_role": user_ctx.user_role or "",
                    },
                )
                cached_result = await cache.get(cache_key)
                if cached_result is not None:
                    log.info("query_cache_hit", session_id=session_id)
                    return cached_result

            log.info("execute_read_query", session_id=session_id)

            result = await svc.data_service.execute_read_query(query, session_id)

            # Cache the result
            if cache is not None and cache_key is not None:
                await cache.set(cache_key, result)

            return result

        @mcp.tool()
        async def get_schema_context(auth_context: str = "") -> str:
            """
            Return live database schema context as Markdown — tables, columns,
            comments, foreign keys, text-match joins, and analyst perspectives.

            The analytics agent calls this once at startup to inject up-to-date
            schema knowledge into its planner system prompt. Output reflects the
            current pg_catalog plus relationships declared in
            platform/db/relationships.yaml — there is no separate schema cache
            for callers to maintain.

            Args:
                auth_context: HMAC-signed auth token (system-injected, do not set).

            Returns:
                JSON-encoded Markdown string, or an error JSON.
            """
            user_ctx = verify_auth_context(auth_context)
            is_authorized = await svc.authorizer.authorize(
                "get_schema_context", {"user_role": user_ctx.user_role}
            )
            if not is_authorized:
                log.warning("opa_denied", tool="get_schema_context")
                return make_error("unauthorized", "Execution blocked by policy engine.")

            cache = svc._cache
            # Bump version on schema-shape changes (new section in relationships.yaml,
            # new column-comment file, etc.) so existing redis caches don't serve
            # stale Markdown. Last bump: glossary section added.
            cache_key = make_cache_key("get_schema_context", {"v": 2})
            if cache is not None:
                cached = await cache.get(cache_key)
                if cached is not None:
                    log.info("schema_cache_hit")
                    return cached

            schemas = ["bankdw", "salesforce"]
            yaml_path = os.getenv(
                "RELATIONSHIPS_YAML_PATH", "/app/platform/db/relationships.yaml"
            )
            try:
                ctx = await introspect_schema(
                    svc._db_pool, schemas, relationships_path=yaml_path
                )
                result = format_for_prompt(ctx)
            except Exception as exc:
                log.error("schema_introspection_failed", error=str(exc))
                return make_error(
                    "introspection_failed", f"Schema introspection error: {exc}"
                )

            log.info(
                "schema_context_built",
                tables=len(ctx.tables),
                fks=len(ctx.foreign_keys),
                text_joins=len(ctx.text_joins),
                perspectives=len(ctx.perspectives),
                bytes=len(result),
            )

            if cache is not None:
                await cache.set(cache_key, result)
            return result
