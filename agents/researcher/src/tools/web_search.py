"""
Web search tool for the research agent.
Uses DuckDuckGo as a free, no-API-key search provider.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


@tool
def web_search(query: str, max_results: int = 5) -> str:
    """Search the web for information.

    Args:
        query: The search query string.
        max_results: Maximum number of results to return (default: 5).

    Returns:
        A formatted string of search results with titles, URLs, and snippets.
    """
    try:
        from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))

        if not results:
            return f"No results found for: {query}"

        formatted = []
        for i, r in enumerate(results, 1):
            formatted.append(
                f"[{i}] {r.get('title', 'No title')}\n"
                f"    URL: {r.get('href', 'N/A')}\n"
                f"    {r.get('body', 'No snippet')}"
            )
        return "\n\n".join(formatted)

    except ImportError:
        return "Web search is not available (duckduckgo-search not installed)."
    except Exception as e:
        logger.warning("Web search failed: %s", e)
        return f"Search failed: {e}"


@tool
def web_search_news(query: str, max_results: int = 5) -> str:
    """Search for recent news articles.

    Args:
        query: The news search query string.
        max_results: Maximum number of results to return (default: 5).

    Returns:
        A formatted string of news results with titles, dates, URLs, and snippets.
    """
    try:
        from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            results = list(ddgs.news(query, max_results=max_results))

        if not results:
            return f"No news found for: {query}"

        formatted = []
        for i, r in enumerate(results, 1):
            formatted.append(
                f"[{i}] {r.get('title', 'No title')}\n"
                f"    Date: {r.get('date', 'N/A')}\n"
                f"    Source: {r.get('source', 'N/A')}\n"
                f"    URL: {r.get('url', 'N/A')}\n"
                f"    {r.get('body', 'No snippet')}"
            )
        return "\n\n".join(formatted)

    except ImportError:
        return "News search is not available (duckduckgo-search not installed)."
    except Exception as e:
        logger.warning("News search failed: %s", e)
        return f"News search failed: {e}"
