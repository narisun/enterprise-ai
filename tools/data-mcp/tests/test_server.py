"""
Unit tests for the data-mcp server.

Tests cover:
- UUID validation (SQL injection prevention)
- Query type enforcement (SELECT-only)
- OPA denial flow
- Truncation of large results
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture(autouse=True)
def env_vars(monkeypatch):
    """Supply all required env vars and bypass real external connections."""
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_USER", "test")
    monkeypatch.setenv("DB_PASS", "test")
    monkeypatch.setenv("DB_NAME", "test")
    monkeypatch.setenv("OPA_URL", "http://localhost:8181/v1/data/mcp/tools/allow")


# ---- UUID Validation --------------------------------------------------------

class TestIsValidUuid:
    def test_valid_uuid_returns_true(self):
        from src.server import _is_valid_uuid
        assert _is_valid_uuid("123e4567-e89b-12d3-a456-426614174000") is True

    def test_invalid_string_returns_false(self):
        from src.server import _is_valid_uuid
        assert _is_valid_uuid("not-a-uuid") is False

    def test_empty_string_returns_false(self):
        from src.server import _is_valid_uuid
        assert _is_valid_uuid("") is False

    def test_sql_injection_attempt_returns_false(self):
        from src.server import _is_valid_uuid
        assert _is_valid_uuid("'; DROP TABLE users; --") is False


# ---- Query Execution --------------------------------------------------------

VALID_SESSION = "123e4567-e89b-12d3-a456-426614174000"


@pytest.mark.asyncio
async def test_rejects_mutating_query_after_opa_allow():
    """Regex guard blocks non-SELECT even if OPA approves."""
    with patch("src.server._authorize_with_opa", new=AsyncMock(return_value=True)), \
         patch("src.server._tracer", MagicMock()), \
         patch("src.server._db_pool", MagicMock()):

        from src.server import execute_read_query
        result = await execute_read_query("DROP TABLE accounts;", VALID_SESSION)

    assert "Security policy violation" in result


@pytest.mark.asyncio
async def test_rejects_invalid_session_id():
    """UUID check blocks queries with a malformed session_id."""
    with patch("src.server._authorize_with_opa", new=AsyncMock(return_value=True)), \
         patch("src.server._tracer", MagicMock()), \
         patch("src.server._db_pool", MagicMock()):

        from src.server import execute_read_query
        result = await execute_read_query("SELECT 1", "not-a-valid-uuid")

    assert "Invalid session_id" in result


@pytest.mark.asyncio
async def test_opa_denial_blocks_execution():
    """When OPA returns False the query is never executed."""
    with patch("src.server._authorize_with_opa", new=AsyncMock(return_value=False)), \
         patch("src.server._tracer", MagicMock()), \
         patch("src.server._db_pool", MagicMock()):

        from src.server import execute_read_query
        result = await execute_read_query("SELECT 1", VALID_SESSION)

    assert "Unauthorized" in result


@pytest.mark.asyncio
async def test_returns_no_records_message_on_empty_result():
    """Empty query result returns a friendly message, not an empty JSON array."""
    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[])
    mock_conn.execute = AsyncMock()
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=None)

    mock_transaction = MagicMock()
    mock_transaction.__aenter__ = AsyncMock(return_value=None)
    mock_transaction.__aexit__ = AsyncMock(return_value=None)
    mock_conn.transaction = MagicMock(return_value=mock_transaction)

    mock_pool = MagicMock()
    mock_pool.acquire = MagicMock(return_value=mock_conn)

    with patch("src.server._authorize_with_opa", new=AsyncMock(return_value=True)), \
         patch("src.server._tracer", MagicMock()), \
         patch("src.server._db_pool", mock_pool):

        from src.server import execute_read_query
        result = await execute_read_query("SELECT 1", VALID_SESSION)

    assert "No records found" in result


@pytest.mark.asyncio
async def test_truncates_large_results():
    """Results larger than MAX_RESULT_BYTES are truncated with a marker."""
    large_row = {"data": "x" * 200}
    many_rows = [large_row] * 100    # ~20 KB

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[MagicMock(__iter__=lambda s: iter(large_row.items()),
                                                         keys=lambda: large_row.keys(),
                                                         values=lambda: large_row.values())] * 100)
    mock_conn.execute = AsyncMock()
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=None)

    mock_transaction = MagicMock()
    mock_transaction.__aenter__ = AsyncMock(return_value=None)
    mock_transaction.__aexit__ = AsyncMock(return_value=None)
    mock_conn.transaction = MagicMock(return_value=mock_transaction)

    mock_pool = MagicMock()
    mock_pool.acquire = MagicMock(return_value=mock_conn)

    # Patch dict() conversion to return large data
    with patch("src.server._authorize_with_opa", new=AsyncMock(return_value=True)), \
         patch("src.server._tracer", MagicMock()), \
         patch("src.server._db_pool", mock_pool), \
         patch("src.server.MAX_RESULT_BYTES", 100), \
         patch("json.dumps", return_value="x" * 200):

        from src.server import execute_read_query
        result = await execute_read_query("SELECT data FROM big_table", VALID_SESSION)

    assert "TRUNCATED" in result
