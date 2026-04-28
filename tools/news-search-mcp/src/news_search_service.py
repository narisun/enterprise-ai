"""Pure business logic for news search operations.

Handles:
- Mock news data for seed companies
- Tavily API integration (async with thread executor)
- Signal derivation from article sentiment and types
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any


# Mock news data for the 4 seed companies
# URLs use mock.internal to make it unambiguous that these are not real articles.
_MOCK_NEWS: dict[str, list] = {
    "acme manufacturing": [
        {
            "title": "Acme Manufacturing announces European market expansion",
            "source": "Reuters",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=4)).strftime("%Y-%m-%d"),
            "url": "https://mock.internal/reuters/acme-europe-expansion",
            "summary": "Acme Manufacturing plans to open two distribution facilities in Germany, targeting €200M in European revenue by 2027. The expansion includes new vendor partnerships in the Netherlands.",
            "sentiment": "positive",
            "signal_type": "expansion",
        },
        {
            "title": "Acme Manufacturing Q4 revenue beats estimates",
            "source": "Bloomberg",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=12)).strftime(
                "%Y-%m-%d"
            ),
            "url": "https://mock.internal/bloomberg/acme-q4-results",
            "summary": "Acme Manufacturing reported Q4 revenue of $142M, beating analyst estimates by 8%. Management cited strong demand from automotive and aerospace customers.",
            "sentiment": "positive",
            "signal_type": "financial_results",
        },
    ],
    "abc logistics": [
        {
            "title": "ABC Logistics wins $80M Amazon warehouse contract",
            "source": "Supply Chain Dive",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d"),
            "url": "https://mock.internal/supplychaindive/abc-amazon-contract",
            "summary": "ABC Logistics secured a multi-year contract to manage Amazon fulfillment operations across six Midwest distribution centers, adding significant revenue to their growing Midwest corridor.",
            "sentiment": "positive",
            "signal_type": "expansion",
        },
    ],
    "globaltech corp": [
        {
            "title": "GlobalTech Corp CFO Michael Chen departs for competitor",
            "source": "Wall Street Journal",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=55)).strftime(
                "%Y-%m-%d"
            ),
            "url": "https://mock.internal/wsj/globaltech-cfo-departure",
            "summary": "GlobalTech Corp CFO Michael Chen has resigned to join a competing enterprise SaaS firm. The company has appointed Angela Novak as interim CFO while conducting a permanent search.",
            "sentiment": "negative",
            "signal_type": "leadership_change",
        },
        {
            "title": "GlobalTech Corp announces 8% workforce reduction amid cost cuts",
            "source": "TechCrunch",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=30)).strftime(
                "%Y-%m-%d"
            ),
            "url": "https://mock.internal/techcrunch/globaltech-layoffs",
            "summary": "GlobalTech Corp is reducing headcount by approximately 960 employees (8%) as part of a broader cost optimization initiative. The company cited slower enterprise software spending in Q4.",
            "sentiment": "negative",
            "signal_type": "financial_stress",
        },
        {
            "title": "GlobalTech Corp banking relationship review underway",
            "source": "Financial Times",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=20)).strftime(
                "%Y-%m-%d"
            ),
            "url": "https://mock.internal/ft/globaltech-banking-review",
            "summary": "GlobalTech Corp is conducting a comprehensive banking relationship review under new CFO Angela Novak. Multiple banks including JPMorgan and regional players are competing for the business.",
            "sentiment": "neutral",
            "signal_type": "banking_activity",
        },
    ],
    "meridian healthcare": [
        {
            "title": "Meridian Healthcare completes acquisition of MedImage Canada",
            "source": "Modern Healthcare",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=110)).strftime(
                "%Y-%m-%d"
            ),
            "url": "https://mock.internal/modernhealthcare/meridian-medimage",
            "summary": "Meridian Healthcare has completed the $45M acquisition of MedImage Canada, a leading medical imaging technology company. The deal adds 80 employees and expands Meridian's diagnostic capabilities into the Canadian market.",
            "sentiment": "positive",
            "signal_type": "acquisition",
        },
        {
            "title": "Meridian Healthcare receives $12M CMS quality bonus",
            "source": "Healthcare Finance",
            "published_date": (datetime.now(timezone.utc) - timedelta(days=15)).strftime(
                "%Y-%m-%d"
            ),
            "url": "https://mock.internal/healthcarefinance/meridian-cms-bonus",
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
        "published_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "url": "",
        "summary": "No significant recent news articles were found for this company in the mock dataset. In production, Tavily search would retrieve real headlines.",
        "sentiment": "neutral",
        "signal_type": "no_news",
    }
]


class NewsSearchService:
    """Pure business logic for news search operations."""

    def __init__(self, tavily_client: Any = None) -> None:
        """
        Initialize the news search service.

        Args:
            tavily_client: Optional Tavily client instance. If None, mock data is used.
        """
        self.tavily_client = tavily_client

    async def search(self, company_name: str) -> dict:
        """
        Search for news about a company.

        Args:
            company_name: The company name to search for.

        Returns:
            A dict containing articles, article_count, aggregate_signal, and searched_at.
        """
        if self.tavily_client:
            articles = await self._search_tavily(company_name)
        else:
            articles = self._get_mock_articles(company_name)

        aggregate_signal = self._derive_aggregate_signal(articles)

        return {
            "company": company_name,
            "articles": articles,
            "article_count": len(articles),
            "aggregate_signal": aggregate_signal,
            "searched_at": datetime.now(timezone.utc).isoformat(),
        }

    async def _search_tavily(self, company_name: str) -> list:
        """
        Search using Tavily API.

        TavilyClient.search() is a synchronous blocking HTTP call. We delegate
        it to a thread pool executor so other concurrent requests are not stalled.

        Args:
            company_name: The company name to search for.

        Returns:
            A list of article dicts.
        """
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self.tavily_client.search(
                query=f"{company_name} company news business",
                search_depth="basic",
                max_results=5,
                include_answer=False,
            ),
        )
        articles = []
        for r in response.get("results", []):
            articles.append(
                {
                    "title": r.get("title", ""),
                    "source": r.get("url", "").split("/")[2] if r.get("url") else "Unknown",
                    "published_date": r.get(
                        "published_date", datetime.now(timezone.utc).strftime("%Y-%m-%d")
                    ),
                    "url": r.get("url", ""),
                    "summary": r.get("content", "")[:500],
                    "sentiment": "neutral",
                    "signal_type": "news",
                }
            )
        return articles

    def _get_mock_articles(self, company_name: str) -> list:
        """
        Return mock articles for known companies, generic otherwise.

        Args:
            company_name: The company name to look up.

        Returns:
            A list of article dicts.
        """
        key = company_name.lower().strip()
        for mock_key, articles in _MOCK_NEWS.items():
            if mock_key in key or key in mock_key:
                return articles
        return _GENERIC_MOCK

    def _derive_aggregate_signal(self, articles: list) -> str:
        """
        Derive an aggregate signal from article sentiment and types.

        Args:
            articles: List of article dicts.

        Returns:
            A string signal summary.
        """
        signals = [a["signal_type"] for a in articles if a["signal_type"] != "neutral"]
        negative = any(a["sentiment"] == "negative" for a in articles)
        positive = any(a["sentiment"] == "positive" for a in articles)

        if negative and "leadership_change" in signals:
            return "RISK: Leadership change detected"
        elif negative and "financial_stress" in signals:
            return "RISK: Financial stress signals"
        elif "acquisition" in signals or "expansion" in signals:
            return "OPPORTUNITY: Growth/expansion activity"
        elif "funding" in signals:
            return "OPPORTUNITY: Funding activity"
        elif positive:
            return "POSITIVE: Favourable news"
        elif not articles or articles[0]["signal_type"] == "no_news":
            return "NO_NEWS: No significant recent news"
        else:
            return "NEUTRAL: No strong signals"
