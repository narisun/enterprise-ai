"""
Unit tests for the news-search-mcp server.

Tests cover:
- OPA denial flow
- Empty/invalid input rejection
- Mock news data retrieval for known companies
- Generic fallback for unknown companies
- Tavily fallback on exception
- Aggregate signal calculation
- Cache interaction
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture(autouse=True)
def env_vars(monkeypatch):
    """Supply all required env vars and bypass real external connections."""
    monkeypatch.setenv("OPA_URL", "http://localhost:8181/v1/data/mcp/tools/allow")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    monkeypatch.setenv("MCP_TRANSPORT", "sse")


def _make_opa_mock(authorized: bool) -> MagicMock:
    mock_opa = MagicMock()
    mock_opa.authorize = AsyncMock(return_value=authorized)
    return mock_opa


# ---- Authorization ----------------------------------------------------------

@pytest.mark.asyncio
async def test_opa_denial_blocks_execution():
    """When OPA returns False the search is never executed."""
    with patch("src.server._opa", _make_opa_mock(False)):
        from src.server import search_company_news
        result = await search_company_news("Acme Manufacturing")

    data = json.loads(result)
    assert data["error"] == "unauthorized"


@pytest.mark.asyncio
async def test_opa_none_returns_not_initialised():
    """If OPA client isn't ready, return a structured error."""
    with patch("src.server._opa", None):
        from src.server import search_company_news
        result = await search_company_news("Acme")

    data = json.loads(result)
    assert data["error"] == "service_not_initialised"


# ---- Input validation -------------------------------------------------------

@pytest.mark.asyncio
async def test_empty_company_name_rejected():
    """Empty company_name returns an error."""
    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._cache", None):
        from src.server import search_company_news
        result = await search_company_news("")

    data = json.loads(result)
    assert data["error"] == "invalid_input"


@pytest.mark.asyncio
async def test_whitespace_only_company_name_rejected():
    """Whitespace-only company_name returns an error."""
    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._cache", None):
        from src.server import search_company_news
        result = await search_company_news("   ")

    data = json.loads(result)
    assert data["error"] == "invalid_input"


# ---- Mock data retrieval ----------------------------------------------------

@pytest.mark.asyncio
async def test_returns_mock_data_for_acme():
    """Known seed company returns curated mock articles."""
    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._cache", None), \
         patch("src.server._tavily_client", None):
        from src.server import search_company_news
        result = await search_company_news("Acme Manufacturing")

    data = json.loads(result)
    assert data["article_count"] == 2
    assert data["company"] == "Acme Manufacturing"
    assert any("Acme" in a["title"] for a in data["articles"])


@pytest.mark.asyncio
async def test_returns_generic_mock_for_unknown_company():
    """Unknown company returns generic mock fallback."""
    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._cache", None), \
         patch("src.server._tavily_client", None):
        from src.server import search_company_news
        result = await search_company_news("Unknown Corp XYZ")

    data = json.loads(result)
    assert data["article_count"] == 1
    assert data["articles"][0]["signal_type"] == "no_news"


@pytest.mark.asyncio
async def test_returns_globaltech_risk_signal():
    """GlobalTech has leadership change + financial stress → RISK signal."""
    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._cache", None), \
         patch("src.server._tavily_client", None):
        from src.server import search_company_news
        result = await search_company_news("GlobalTech Corp")

    data = json.loads(result)
    assert "RISK" in data["aggregate_signal"]
    assert data["article_count"] == 3


# ---- Tavily fallback --------------------------------------------------------

@pytest.mark.asyncio
async def test_tavily_exception_falls_back_to_mock():
    """If Tavily raises an exception, mock data is returned instead."""
    broken_tavily = MagicMock()

    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._cache", None), \
         patch("src.server._tavily_client", broken_tavily), \
         patch("src.server._search_tavily", AsyncMock(side_effect=RuntimeError("Tavily down"))):
        from src.server import search_company_news
        result = await search_company_news("Acme Manufacturing")

    data = json.loads(result)
    # Should fall back to mock data, not crash
    assert data["article_count"] >= 1


# ---- Cache ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cache_hit_returns_cached_result():
    """Cached result is returned without running the search."""
    cached_data = json.dumps({"company": "Cached Corp", "articles": [], "article_count": 0,
                               "aggregate_signal": "CACHED", "searched_at": "2025-01-01T00:00:00Z"})
    mock_cache = MagicMock()
    mock_cache.get = AsyncMock(return_value=cached_data)

    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._cache", mock_cache):
        from src.server import search_company_news
        result = await search_company_news("Cached Corp")

    data = json.loads(result)
    assert data["aggregate_signal"] == "CACHED"
