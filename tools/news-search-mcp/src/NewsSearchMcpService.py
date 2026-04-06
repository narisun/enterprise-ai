"""MCP service layer for news search with OPA authorization and caching.

Extends McpService to handle:
- Tool registration with @mcp.tool() decorator
- OPA authorization checks
- Result caching with TTL
- Delegation to NewsSearchService for business logic
"""
import json
import os
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Optional

from platform_sdk import MCPConfig, configure_logging, get_logger, make_error
from platform_sdk.base import McpService
from platform_sdk.cache import make_cache_key
from platform_sdk.protocols import Authorizer, CacheStore

from .NewsSearchService import NewsSearchService

configure_logging()
log = get_logger(__name__)


@dataclass(frozen=True)
class ServerContext:
    """Runtime dependencies for tool functions."""
    opa: Authorizer
    cache: Optional[CacheStore]
    news_service: NewsSearchService


_ctx: ContextVar[ServerContext] = ContextVar("news_mcp_ctx")


class NewsSearchMcpService(McpService):
    """MCP service for news search with authorization and caching."""

    cache_ttl_seconds = 1800  # 30 minutes
    requires_database = False

    def __init__(
        self,
        name: str = "news-search-mcp",
        *,
        config: Optional[MCPConfig] = None,
        authorizer: Optional[Authorizer] = None,
        cache: Optional[CacheStore] = None,
    ) -> None:
        """
        Initialize the news search MCP service.

        Args:
            name: Service name (default: "news-search-mcp").
            config: Optional MCPConfig to inject.
            authorizer: Optional Authorizer to inject.
            cache: Optional CacheStore to inject.
        """
        super().__init__(name, config=config, authorizer=authorizer, cache=cache)
        self.news_service: Optional[NewsSearchService] = None

    async def on_startup(self) -> None:
        """Initialize the news service during startup."""
        # Get or create Tavily client
        tavily_client = None
        tavily_key = os.environ.get("TAVILY_API_KEY", "")
        if tavily_key:
            try:
                from tavily import TavilyClient
                tavily_client = TavilyClient(api_key=tavily_key)
                log.info("news_mcp_ready", mode="tavily")
            except ImportError:
                log.warning("tavily_not_installed", fallback="mock")
        else:
            log.info("news_mcp_ready", mode="mock", reason="TAVILY_API_KEY not set")

        # Create the business logic service
        self.news_service = NewsSearchService(tavily_client=tavily_client)

    def register_tools(self, mcp: Any) -> None:
        """
        Register the search_company_news tool with the MCP server.

        Args:
            mcp: The FastMCP server instance.
        """
        # Capture self for lazy access in closures — properties like
        # self.authorizer and self.news_service are only available
        # after the lifespan runs, NOT at registration time.
        svc = self

        @mcp.tool()
        async def search_company_news(company_name: str) -> str:
            """
            Search for recent news about a company.

            Returns headlines, summaries, source URLs, and business signal
            classifications (expansion, risk, regulatory, financial_stress, etc.).

            Uses Tavily Search API when TAVILY_API_KEY is configured.
            Falls back to curated mock data for local development.

            Args:
                company_name: Company name to search for.

            Returns:
                JSON string with articles list and aggregate signal summary.
            """
            # Input validation
            if not company_name or not company_name.strip():
                return make_error("invalid_input", "company_name must not be empty.")
            company_name = company_name.strip()[:256]

            # OPA authorization (resolved at request time)
            is_authorized = await svc.authorizer.authorize(
                "search_company_news", {"company_name": company_name}
            )
            if not is_authorized:
                log.warning("opa_denied", tool="search_company_news")
                return make_error("unauthorized", "Execution blocked by policy engine.")

            # Cache lookup
            cache_key = None
            cache = svc._cache
            if cache is not None:
                cache_key = make_cache_key("search_company_news", {"company_name": company_name})
                cached = await cache.get(cache_key)
                if cached is not None:
                    log.info("news_cache_hit", company=company_name)
                    return cached

            log.info("news_tool_call", company=company_name)

            try:
                result = await svc.news_service.search(company_name)
            except Exception as exc:
                log.error("news_search_error", company=company_name, error=str(exc))
                result = await svc.news_service.search(company_name)

            output = json.dumps(result, default=str)

            # Cache the result
            if cache is not None and cache_key is not None:
                await cache.set(cache_key, output)

            return output
