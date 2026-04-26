"""MCP service layer for payments with OPA authorization and caching.

Extends McpService to handle:
- Tool registration with @mcp.tool() decorator
- OPA authorization checks
- AgentContext extraction (col_mask, row_filters)
- Result caching with TTL
- Delegation to PaymentsService for business logic
"""
from typing import Any, Optional

from platform_sdk import MCPConfig, configure_logging, get_logger, make_error
from platform_sdk.auth import AgentContext
from platform_sdk.base import McpService
from platform_sdk.cache import make_cache_key
from platform_sdk.protocols import Authorizer, CacheStore
from tools_shared.mcp_auth import get_agent_context, verify_auth_context

from .payments_service import PaymentsService

configure_logging()
log = get_logger(__name__)


class PaymentsMcpService(McpService):
    """MCP service for payments with authorization, caching, and compliance masking."""

    cache_ttl_seconds = 3600
    requires_database = True
    assert_secrets = True

    def __init__(
        self,
        name: str = "payments-mcp",
        *,
        config: Optional[MCPConfig] = None,
        authorizer: Optional[Authorizer] = None,
        cache: Optional[CacheStore] = None,
        db_pool: Any = None,
    ) -> None:
        """
        Initialize the payments MCP service.

        Args:
            name: Service name (default: "payments-mcp").
            config: Optional MCPConfig to inject.
            authorizer: Optional Authorizer to inject.
            cache: Optional CacheStore to inject.
            db_pool: Optional database pool to inject (used in tests).
        """
        super().__init__(name, config=config, authorizer=authorizer, cache=cache, db_pool=db_pool)
        self.payments_service: Optional[PaymentsService] = None

    async def on_startup(self) -> None:
        """Initialize the payments service during startup."""
        # Get max_result_bytes from config
        max_result_bytes = getattr(self.config, "max_result_bytes", 15_000) if self.config else 15_000

        # Create the business logic service
        self.payments_service = PaymentsService(
            db_pool=self.db_pool,
            max_result_bytes=max_result_bytes,
        )
        log.info("payments_mcp_ready")

    def register_tools(self, mcp: Any) -> None:
        """
        Register the get_payment_summary tool with the MCP server.

        Args:
            mcp: The FastMCP server instance.
        """
        # Capture self for lazy access in closures — properties like
        # self.authorizer and self.payments_service are only available
        # after the lifespan runs, NOT at registration time.
        svc = self

        @mcp.tool()
        async def get_payment_summary(client_name: str, auth_context: str = "") -> str:
            """
            Get bank payment transaction summary for a client.

            Queries the bank data warehouse (bankdw schema) using the client's company
            name as the join key. Supports fuzzy name matching — partial names like
            "IBM", "Pepsi", or "Google" are automatically resolved to the full party
            name via ILIKE prefix/substring search against dim_party and fact_payments.

            Returns outbound/inbound volumes by payment rail (ACH/Wire/RTP), trend vs
            prior period, top counterparties, sending bank diversity, transaction status
            mix, and party compliance profile (fields visible per caller's clearance level).

            The look-back window is fixed at 360 days.

            Args:
                client_name: Company name (full or partial — fuzzy matching supported).
                auth_context: HMAC-signed auth token (system-injected, do not set).

            Returns:
                JSON string with payment analytics, or error JSON if no data found.
            """
            # Input validation
            if not client_name or not client_name.strip():
                return make_error("invalid_input", "client_name must not be empty.")

            # Truncate excessively long client names (defence against log/cache abuse)
            client_name = client_name.strip()[:256]

            # Extract verified user identity from HMAC-signed auth context
            user_ctx = verify_auth_context(auth_context)

            # OPA authorization (resolved at request time)
            is_authorized = await svc.authorizer.authorize(
                "get_payment_summary", {"client_name": client_name, "user_role": user_ctx.user_role}
            )
            if not is_authorized:
                log.warning("opa_denied", tool="get_payment_summary")
                return make_error("unauthorized", "Execution blocked by policy engine.")

            # Resolve column mask from the per-request AgentContext.
            # If no valid signed context header is present, use anonymous()
            # which grants minimum privilege — all compliance columns are masked.
            agent_ctx = get_agent_context()
            if agent_ctx is None:
                agent_ctx = AgentContext.anonymous()
                log.warning("no_agent_context", tool="get_payment_summary", fallback="anonymous/readonly")

            col_mask = agent_ctx.build_col_mask()

            # Row-level filter for standard RM role
            row_filters = agent_ctx.build_row_filters_payments(party_names=[client_name])
            if row_filters.get("fact_payments") == ["__DENY_ALL__"]:
                log.warning("row_filter_deny", tool="get_payment_summary", role=agent_ctx.role)
                return make_error("unauthorized", "You do not have access to payment data for this client.")

            # Cache key includes the col_mask so different clearance levels get
            # separate entries (a compliance_full user must not get an rm-masked entry).
            col_mask_key = ",".join(sorted(col_mask))
            cache_key = None
            cache = svc._cache

            if cache is not None:
                cache_key = make_cache_key(
                    "get_payment_summary",
                    {"client_name": client_name, "col_mask_key": col_mask_key},
                )
                cached = await cache.get(cache_key)
                if cached is not None:
                    log.info("payments_cache_hit", client=client_name)
                    return cached

            log.info("payments_tool_call", client=client_name, role=agent_ctx.role)

            try:
                result = await svc.payments_service.get_summary(client_name, col_mask)
            except Exception as exc:
                # Log full details server-side; return a safe message to the agent
                exc_type = type(exc).__name__
                log.error(
                    "payments_error",
                    exc_type=exc_type,
                    error=str(exc),
                    exc_info=True,
                )
                return make_error("service_error", f"A {exc_type} occurred. Please try again.")

            # Cache the result
            if cache is not None and cache_key is not None:
                await cache.set(cache_key, result)

            return result
