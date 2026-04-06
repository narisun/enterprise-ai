"""MCP service layer for Salesforce with OPA authorization and caching.

Extends McpService to handle:
- Tool registration with @mcp.tool() decorator
- OPA authorization checks
- Result caching with TTL
- Agent context handling
- Delegation to SalesforceService for business logic
"""
import json
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Optional

from platform_sdk import MCPConfig, configure_logging, get_logger
from platform_sdk.auth import AgentContext
from platform_sdk.base import McpService
from platform_sdk.cache import make_cache_key
from platform_sdk.protocols import Authorizer, CacheStore
from tools_shared.mcp_auth import get_agent_context

import asyncpg

from .SalesforceService import SalesforceService

configure_logging()
log = get_logger(__name__)


@dataclass(frozen=True)
class ServerContext:
    """Runtime dependencies for tool functions."""
    opa: Authorizer
    cache: Optional[CacheStore]
    salesforce_service: SalesforceService


_ctx: ContextVar[ServerContext] = ContextVar("salesforce_mcp_ctx")


class SalesforceMcpService(McpService):
    """MCP service for Salesforce CRM with authorization and caching."""

    cache_ttl_seconds = 1800  # 30 minutes
    requires_database = True
    assert_secrets = True

    def __init__(
        self,
        name: str = "salesforce-mcp",
        *,
        config: Optional[MCPConfig] = None,
        authorizer: Optional[Authorizer] = None,
        cache: Optional[CacheStore] = None,
        db_pool: Optional[asyncpg.Pool] = None,
    ) -> None:
        """
        Initialize the Salesforce MCP service.

        Args:
            name: Service name (default: "salesforce-mcp").
            config: Optional MCPConfig to inject.
            authorizer: Optional Authorizer to inject.
            cache: Optional CacheStore to inject.
            db_pool: Optional database connection pool to inject.
        """
        super().__init__(name, config=config, authorizer=authorizer, cache=cache, db_pool=db_pool)
        self.salesforce_service: Optional[SalesforceService] = None

    async def on_startup(self) -> None:
        """Initialize the Salesforce service during startup."""
        # Create the business logic service
        self.salesforce_service = SalesforceService(db_pool=self.db_pool)
        log.info("salesforce_mcp_ready")

    def register_tools(self, mcp: Any) -> None:
        """
        Register the get_salesforce_summary tool with the MCP server.

        Args:
            mcp: The FastMCP server instance.
        """
        # Capture self for lazy access in closures — properties like
        # self.authorizer and self.salesforce_service are only available
        # after the lifespan runs, NOT at registration time.
        svc = self

        # Roles that may see contact PII (email, phone)
        pii_allowed_roles = {"rm", "senior_rm", "manager", "compliance_officer"}

        @mcp.tool()
        async def get_salesforce_summary(client_name: str) -> str:
            """
            Get Salesforce CRM summary for a client.

            Returns account profile, key contacts, recent activities (365 days),
            open opportunities with pipeline stage and value, and pending tasks.

            The response includes account_id and account_name which are required by
            get_payment_summary (exact name match in bankdw).

            Args:
                client_name: Company name as known in Salesforce (partial match supported).

            Returns:
                JSON string with full CRM context, or error JSON if client not found.
            """
            if not client_name or not client_name.strip():
                return json.dumps({
                    "error": "invalid_input",
                    "message": "client_name must not be empty."
                })

            client_name = client_name.strip()[:256]

            # OPA authorization (resolved at request time)
            is_authorized = await svc.authorizer.authorize(
                "get_salesforce_summary", {"client_name": client_name}
            )
            if not is_authorized:
                log.warning("opa_denied", tool="get_salesforce_summary")
                return json.dumps({
                    "error": "unauthorized",
                    "message": "Execution blocked by policy engine."
                })

            # Resolve caller identity and access rights from the signed X-Agent-Context header.
            # Falls back to minimum-privilege anonymous context if header is absent/invalid.
            agent_ctx = get_agent_context()
            if agent_ctx is None:
                agent_ctx = AgentContext.anonymous()
                log.warning("no_agent_context", tool="get_salesforce_summary", fallback="anonymous/readonly")

            allow_pii = agent_ctx.role in pii_allowed_roles
            unrestricted = agent_ctx.role in ("senior_rm", "manager", "compliance_officer")
            assigned_ids = agent_ctx.assigned_account_ids

            # Cache key includes role so different clearance levels get separate entries.
            cache_key = None
            cache = svc._cache
            if cache is not None:
                cache_key = make_cache_key(
                    "get_salesforce_summary",
                    {"client_name": client_name, "role": agent_ctx.role},
                )
                cached = await cache.get(cache_key)
                if cached is not None:
                    log.info("crm_cache_hit", client=client_name)
                    return cached

            log.info("salesforce_tool_call", client=client_name, role=agent_ctx.role, allow_pii=allow_pii)

            try:
                result = await svc.salesforce_service.get_summary(
                    client_name,
                    allow_pii=allow_pii,
                    assigned_account_ids=assigned_ids,
                    unrestricted=unrestricted,
                )
            except asyncpg.PostgresError as exc:
                log.error("db_error", error=str(exc))
                return json.dumps({
                    "error": "database_error",
                    "message": "A database error occurred. Please try again."
                })

            if cache is not None and cache_key is not None:
                await cache.set(cache_key, result)

            return result
