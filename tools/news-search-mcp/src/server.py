"""
News Search MCP Server.

Tool: search_company_news(company_name)
  When TAVILY_API_KEY is set: uses Tavily Search API for real news.
  When not set: returns deterministic mock news for the 4 seed companies,
  generic mock for others. Safe for local dev and CI.

Cache TTL: 1800s (30 minutes).
"""
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

from mcp.server.fastmcp import FastMCP

from platform_sdk import ToolResultCache, configure_logging, get_logger

configure_logging()
log = get_logger(__name__)

_cache: Optional[ToolResultCache] = None
_tavily_client = None

TRANSPORT = os.environ.get("MCP_TRANSPORT", "sse")
PORT = int(os.environ.get("PORT", 8083))

# ---- Mock news data for the 4 seed companies --------------------------------
_MOCK_NEWS: dict[str, list] = {
    "acme manufacturing": [
        {
            "title": "Acme Manufacturing announces European market expansion",
            "source": "Reuters",
            "published_date": (datetime.now() - timedelta(days=4)).strftime("%Y-%m-%d"),
            "url": "https://reuters.com/mock/acme-europe-expansion",
            "summary": "Acme Manufacturing plans to open two distribution facilities in Germany, targeting €200M in European revenue by 2027. The expansion includes new vendor partnerships in the Netherlands.",
            "sentiment": "positive",
            "signal_type": "expansion",
        },
        {
            "title": "Acme Manufacturing Q4 revenue beats estimates",
            "source": "Bloomberg",
            "published_date": (datetime.now() - timedelta(days=12)).strftime("%Y-%m-%d"),
            "url": "https://bloomberg.com/mock/acme-q4-results",
            "summary": "Acme Manufacturing reported Q4 revenue of $142M, beating analyst estimates by 8%. Management cited strong demand from automotive and aerospace customers.",
            "sentiment": "positive",
            "signal_type": "financial_results",
        },
    ],
    "abc logistics": [
        {
            "title": "ABC Logistics wins $80M Amazon warehouse contract",
            "source": "Supply Chain Dive",
            "published_date": (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d"),
            "url": "https://supplychaindive.com/mock/abc-amazon-contract",
            "summary": "ABC Logistics secured a multi-year contract to manage Amazon fulfillment operations across six Midwest distribution centers, adding significant revenue to their growing Midwest corridor.",
            "sentiment": "positive",
            "signal_type": "expansion",
        },
    ],
    "globaltech corp": [
        {
            "title": "GlobalTech Corp CFO Michael Chen departs for competitor",
            "source": "Wall Street Journal",
            "published_date": (datetime.now() - timedelta(days=55)).strftime("%Y-%m-%d"),
            "url": "https://wsj.com/mock/globaltech-cfo-departure",
            "summary": "GlobalTech Corp CFO Michael Chen has resigned to join a competing enterprise SaaS firm. The company has appointed Angela Novak as interim CFO while conducting a permanent search.",
            "sentiment": "negative",
            "signal_type": "leadership_change",
        },
        {
            "title": "GlobalTech Corp announces 8% workforce reduction amid cost cuts",
            "source": "TechCrunch",
            "published_date": (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d"),
            "url": "https://techcrunch.com/mock/globaltech-layoffs",
            "summary": "GlobalTech Corp is reducing headcount by approximately 960 employees (8%) as part of a broader cost optimization initiative. The company cited slower enterprise software spending in Q4.",
            "sentiment": "negative",
            "signal_type": "financial_stress",
        },
        {
            "title": "GlobalTech Corp banking relationship review underway",
            "source": "Financial Times",
            "published_date": (datetime.now() - timedelta(days=20)).strftime("%Y-%m-%d"),
            "url": "https://ft.com/mock/globaltech-banking-review",
            "summary": "GlobalTech Corp is conducting a comprehensive banking relationship review under new CFO Angela Novak. Multiple banks including JPMorgan and regional players are competing for the business.",
            "sentiment": "neutral",
            "signal_type": "banking_activity",
        },
    ],
    "meridian healthcare": [
        {
            "title": "Meridian Healthcare completes acquisition of MedImage Canada",
            "source": "Modern Healthcare",
            "published_date": (datetime.now() - timedelta(days=110)).strftime("%Y-%m-%d"),
            "url": "https://modernhealthcare.com/mock/meridian-medimage",
            "summary": "Meridian Healthcare has completed the $45M acquisition of MedImage Canada, a leading medical imaging technology company. The deal adds 80 employees and expands Meridian's diagnostic capabilities into the Canadian market.",
            "sentiment": "positive",
            "signal_type": "acquisition",
        },
        {
            "title": "Meridian Healthcare receives $12M CMS quality bonus",
            "source": "Healthcare Finance",
            "published_date": (datetime.now() - timedelta(days=15)).strftime("%Y-%m-%d"),
            "url": "https://healthcarefinancenews.com/mock/meridian-cms-bonus",
            "summary": "Meridian Healthcare received a $12M CMS value-based care quality bonus, reflecting its four-star patient satisfaction rating. The funds will support new outpatient clinic expansion.",
            "sentiment": "positive",
            "signal_type": "financial_results",
        },
    ],
}

_GENERIC_MOCK = [
    {
        "title": "No recent news found",
        "source": "Mock News Service",
        "published_date": datetime.now().strftime("%Y-%m-%d"),
        "url": "",
        "summary": "No significant recent news articles were found for this company in the mock dataset. In production, Tavily search would retrieve real headlines.",
        "sentiment": "neutral",
        "signal_type": "no_news",
    }
]


@asynccontextmanager
async def _lifespan(server: FastMCP):
    global _cache, _tavily_client
    _cache = ToolResultCache.from_env(ttl_seconds=1800)
    tavily_key = os.environ.get("TAVILY_API_KEY", "")
    if tavily_key:
        try:
            from tavily import TavilyClient
            _tavily_client = TavilyClient(api_key=tavily_key)
            log.info("news_mcp_ready", mode="tavily")
        except ImportError:
            log.warning("tavily_not_installed", fallback="mock")
    else:
        log.info("news_mcp_ready", mode="mock", reason="TAVILY_API_KEY not set")
    yield


mcp = FastMCP("news-search-mcp", lifespan=_lifespan, host="0.0.0.0", port=PORT)


async def _search_tavily(company_name: str) -> list:
    """Search using Tavily API."""
    response = _tavily_client.search(
        query=f"{company_name} company news business",
        search_depth="basic",
        max_results=5,
        include_answer=False,
    )
    articles = []
    for r in response.get("results", []):
        articles.append({
            "title": r.get("title", ""),
            "source": r.get("url", "").split("/")[2] if r.get("url") else "Unknown",
            "published_date": r.get("published_date", datetime.now().strftime("%Y-%m-%d")),
            "url": r.get("url", ""),
            "summary": r.get("content", "")[:500],
            "sentiment": "neutral",
            "signal_type": "news",
        })
    return articles


def _get_mock_articles(company_name: str) -> list:
    """Return mock articles for known companies, generic otherwise."""
    key = company_name.lower().strip()
    for mock_key, articles in _MOCK_NEWS.items():
        if mock_key in key or key in mock_key:
            return articles
    return _GENERIC_MOCK


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
    if _cache:
        from platform_sdk.cache import make_cache_key
        key = make_cache_key("search_company_news", {"company_name": company_name})
        cached = await _cache.get(key)
        if cached:
            log.debug("news_cache_hit", company=company_name)
            return cached

    log.info("news_tool_call", company=company_name, mode="tavily" if _tavily_client else "mock")

    try:
        if _tavily_client:
            articles = await _search_tavily(company_name)
        else:
            articles = _get_mock_articles(company_name)
    except Exception as exc:
        log.error("news_search_error", company=company_name, error=str(exc))
        articles = _get_mock_articles(company_name)

    # Derive aggregate signal
    signals = [a["signal_type"] for a in articles if a["signal_type"] != "neutral"]
    negative = any(a["sentiment"] == "negative" for a in articles)
    positive = any(a["sentiment"] == "positive" for a in articles)

    if negative and "leadership_change" in signals:
        aggregate_signal = "RISK: Leadership change detected"
    elif negative and "financial_stress" in signals:
        aggregate_signal = "RISK: Financial stress signals"
    elif "acquisition" in signals or "expansion" in signals:
        aggregate_signal = "OPPORTUNITY: Growth/expansion activity"
    elif "funding" in signals:
        aggregate_signal = "OPPORTUNITY: Funding activity"
    elif positive:
        aggregate_signal = "POSITIVE: Favourable news"
    elif not articles or articles[0]["signal_type"] == "no_news":
        aggregate_signal = "NO_NEWS: No significant recent news"
    else:
        aggregate_signal = "NEUTRAL: No strong signals"

    result = {
        "company": company_name,
        "articles": articles,
        "article_count": len(articles),
        "aggregate_signal": aggregate_signal,
        "searched_at": datetime.utcnow().isoformat() + "Z",
    }
    output = json.dumps(result, default=str)

    if _cache:
        from platform_sdk.cache import make_cache_key
        key = make_cache_key("search_company_news", {"company_name": company_name})
        await _cache.set(key, output)

    return output


if __name__ == "__main__":
    log.info("mcp_server_starting", transport=TRANSPORT)
    mcp.run(transport=TRANSPORT)
