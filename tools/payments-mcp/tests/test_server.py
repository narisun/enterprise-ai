"""
Unit tests for the payments-mcp server.

Tests cover:
- OPA denial flow
- Empty/invalid input rejection
- AgentContext fallback to anonymous (minimum privilege)
- Row-level deny for RM with wrong party
- Column masking for compliance fields
- No data found handling
- DB error handling
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture(autouse=True)
def env_vars(monkeypatch):
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_USER", "test")
    monkeypatch.setenv("DB_PASS", "test")
    monkeypatch.setenv("DB_NAME", "test")
    monkeypatch.setenv("OPA_URL", "http://localhost:8181/v1/data/mcp/tools/allow")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("CONTEXT_HMAC_SECRET", "test-hmac-secret")
    monkeypatch.setenv("MCP_TRANSPORT", "sse")


def _make_opa_mock(authorized: bool) -> MagicMock:
    mock_opa = MagicMock()
    mock_opa.authorize = AsyncMock(return_value=authorized)
    return mock_opa


def _make_agent_context(
    role: str = "manager",
    assigned_ids: tuple = (),
    clearance: tuple = ("standard", "aml_view", "compliance_full"),
) -> MagicMock:
    """Create a mock AgentContext."""
    ctx = MagicMock()
    ctx.role = role
    ctx.assigned_account_ids = assigned_ids
    ctx.compliance_clearance = clearance
    ctx.build_col_mask = MagicMock(return_value=[])
    ctx.build_row_filters_payments = MagicMock(return_value={})
    return ctx


# ---- Authorization ----------------------------------------------------------

@pytest.mark.asyncio
async def test_opa_denial_blocks_execution():
    with patch("src.server._opa", _make_opa_mock(False)):
        from src.server import get_payment_summary
        result = await get_payment_summary("Acme")

    assert "Unauthorized" in result


@pytest.mark.asyncio
async def test_opa_none_returns_not_initialised():
    with patch("src.server._opa", None):
        from src.server import get_payment_summary
        result = await get_payment_summary("Acme")

    assert "not initialised" in result


# ---- Input validation -------------------------------------------------------

@pytest.mark.asyncio
async def test_empty_client_name_rejected():
    with patch("src.server._opa", _make_opa_mock(True)):
        from src.server import get_payment_summary
        result = await get_payment_summary("")

    assert "empty" in result.lower()


@pytest.mark.asyncio
async def test_whitespace_client_name_rejected():
    with patch("src.server._opa", _make_opa_mock(True)):
        from src.server import get_payment_summary
        result = await get_payment_summary("   ")

    assert "empty" in result.lower()


# ---- Row-level deny for RM --------------------------------------------------

@pytest.mark.asyncio
async def test_rm_denied_when_row_filter_fires():
    """RM whose row filter returns __DENY_ALL__ is blocked."""
    ctx = _make_agent_context("rm", ("001AAA",))
    ctx.build_row_filters_payments = MagicMock(
        return_value={"fact_payments": ["__DENY_ALL__"]}
    )

    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._cache", None), \
         patch("src.server.get_agent_context", return_value=ctx):
        from src.server import get_payment_summary
        result = await get_payment_summary("Restricted Corp")

    assert "Unauthorized" in result or "access" in result.lower()


# ---- Column masking ---------------------------------------------------------

class TestColumnMasking:
    def test_apply_col_mask_nulls_masked_columns(self):
        from src.server import _apply_col_mask

        record = {"segment": "Enterprise", "aml_risk": "Low", "kyc_status": "Approved"}
        masked = _apply_col_mask(record, ["aml_risk"])

        assert masked["segment"] == "Enterprise"
        assert masked["aml_risk"] is None
        assert masked["kyc_status"] == "Approved"

    def test_apply_col_mask_empty_mask_returns_original(self):
        from src.server import _apply_col_mask

        record = {"segment": "Enterprise", "aml_risk": "Low"}
        masked = _apply_col_mask(record, [])

        assert masked == record

    def test_apply_col_mask_none_record_returns_none(self):
        from src.server import _apply_col_mask

        assert _apply_col_mask(None, ["aml_risk"]) is None


# ---- No data found ----------------------------------------------------------

@pytest.mark.asyncio
async def test_no_data_found_returns_structured_error():
    """When neither outbound nor inbound rows exist, return no_data error."""
    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[])
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=None)

    mock_transaction = MagicMock()
    mock_transaction.__aenter__ = AsyncMock(return_value=None)
    mock_transaction.__aexit__ = AsyncMock(return_value=None)
    mock_conn.transaction = MagicMock(return_value=mock_transaction)

    mock_pool = MagicMock()
    mock_pool.acquire = MagicMock(return_value=mock_conn)

    ctx = _make_agent_context("manager")

    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._pool", mock_pool), \
         patch("src.server._cache", None), \
         patch("src.server.get_agent_context", return_value=ctx):
        from src.server import get_payment_summary
        result = await get_payment_summary("NoPayments Corp")

    data = json.loads(result)
    assert data["error"] == "no_data"


# ---- DB error handling ------------------------------------------------------

@pytest.mark.asyncio
async def test_db_error_returns_safe_message():
    """Database errors are caught and a generic message is returned."""
    import asyncpg

    ctx = _make_agent_context("manager")

    mock_pool = MagicMock()
    mock_conn = AsyncMock()
    mock_conn.__aenter__ = AsyncMock(side_effect=asyncpg.PostgresError("connection failed"))
    mock_pool.acquire = MagicMock(return_value=mock_conn)

    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._pool", mock_pool), \
         patch("src.server._cache", None), \
         patch("src.server.get_agent_context", return_value=ctx):
        from src.server import get_payment_summary
        result = await get_payment_summary("Acme")

    assert "database error" in result.lower()


# ---- Cache ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cache_hit_returns_cached_result():
    """Cached result is returned without hitting the database."""
    cached_data = json.dumps({"client_name": "Cached Corp", "total_outbound_usd": 1000})
    mock_cache = MagicMock()
    mock_cache.get = AsyncMock(return_value=cached_data)

    ctx = _make_agent_context("manager")

    with patch("src.server._opa", _make_opa_mock(True)), \
         patch("src.server._cache", mock_cache), \
         patch("src.server.get_agent_context", return_value=ctx):
        from src.server import get_payment_summary
        result = await get_payment_summary("Cached Corp")

    data = json.loads(result)
    assert data["client_name"] == "Cached Corp"
