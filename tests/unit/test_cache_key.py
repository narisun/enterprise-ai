"""
Unit tests for platform_sdk.cache.make_cache_key.

Verifies stability, order-independence, and collision-resistance.
No external dependencies.
"""
import pytest
from platform_sdk.cache import make_cache_key

pytestmark = pytest.mark.unit

_KEY_PREFIX = "tool_cache:"


class TestMakeCacheKey:
    def test_same_inputs_same_key(self):
        k1 = make_cache_key("get_payment_summary", {"client_name": "Acme", "col_mask_key": ""})
        k2 = make_cache_key("get_payment_summary", {"client_name": "Acme", "col_mask_key": ""})
        assert k1 == k2

    def test_different_function_different_key(self):
        k1 = make_cache_key("get_payment_summary", {"client_name": "Acme"})
        k2 = make_cache_key("get_salesforce_summary", {"client_name": "Acme"})
        assert k1 != k2

    def test_order_independence(self):
        """Cache key must not depend on the order kwargs are passed."""
        k1 = make_cache_key("fn", {"a": 1, "b": 2, "c": 3})
        k2 = make_cache_key("fn", {"c": 3, "a": 1, "b": 2})
        assert k1 == k2

    def test_key_starts_with_prefix(self):
        k = make_cache_key("any_tool", {"x": 1})
        assert k.startswith(_KEY_PREFIX)

    def test_different_values_different_keys(self):
        k1 = make_cache_key("fn", {"client_name": "Microsoft Corp."})
        k2 = make_cache_key("fn", {"client_name": "Ford Motor Company"})
        assert k1 != k2

    def test_empty_kwargs_stable(self):
        k1 = make_cache_key("fn", {})
        k2 = make_cache_key("fn", {})
        assert k1 == k2

    def test_empty_kwargs_different_from_nonempty(self):
        k1 = make_cache_key("fn", {})
        k2 = make_cache_key("fn", {"client_name": "x"})
        assert k1 != k2

    def test_col_mask_key_changes_cache_entry(self):
        """
        Different clearance levels must produce different cache keys.
        This prevents an rm-masked result from being served to a manager.
        """
        manager_key = make_cache_key(
            "get_payment_summary",
            {"client_name": "Microsoft Corp.", "col_mask_key": ""},
        )
        rm_key = make_cache_key(
            "get_payment_summary",
            {
                "client_name": "Microsoft Corp.",
                "col_mask_key": "AMLRiskCategory,BSAAMLProgramRating,FraudMonitoringSegment,KYCStatus,"
                                "PEPFlag,RiskRating,SanctionsComplianceStatus,SanctionsScreeningStatus",
            },
        )
        assert manager_key != rm_key

    def test_key_is_hex_string(self):
        k = make_cache_key("fn", {"x": 1})
        suffix = k[len(_KEY_PREFIX):]
        assert all(c in "0123456789abcdef" for c in suffix), "Key suffix must be hex"
        assert len(suffix) == 64, "sha256 digest must be 64 hex chars"

    def test_nested_dict_stable(self):
        k1 = make_cache_key("fn", {"filters": {"Account": ["001AAA"]}})
        k2 = make_cache_key("fn", {"filters": {"Account": ["001AAA"]}})
        assert k1 == k2


class TestCachedToolDecorator:
    """Verify that cached_tool never caches ERROR: responses."""

    @pytest.mark.asyncio
    async def test_error_response_not_cached(self):
        from platform_sdk.cache import cached_tool
        from unittest.mock import AsyncMock, MagicMock

        mock_redis = MagicMock()
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.setex = AsyncMock()

        from platform_sdk.cache import ToolResultCache
        cache = ToolResultCache(redis_client=mock_redis, ttl_seconds=300)

        call_count = 0

        @cached_tool(cache)
        async def flaky_tool(client_name: str) -> str:
            nonlocal call_count
            call_count += 1
            return "ERROR: something went wrong"

        result = await flaky_tool(client_name="Acme")
        assert result.startswith("ERROR:")
        # setex must NOT have been called — errors are never cached
        mock_redis.setex.assert_not_called()

    @pytest.mark.asyncio
    async def test_success_response_is_cached(self):
        from platform_sdk.cache import cached_tool, ToolResultCache
        from unittest.mock import AsyncMock, MagicMock

        mock_redis = MagicMock()
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.setex = AsyncMock()

        cache = ToolResultCache(redis_client=mock_redis, ttl_seconds=300)

        @cached_tool(cache)
        async def good_tool(client_name: str) -> str:
            return '{"result": "data"}'

        result = await good_tool(client_name="Acme")
        assert result == '{"result": "data"}'
        mock_redis.setex.assert_called_once()

    @pytest.mark.asyncio
    async def test_none_cache_is_passthrough(self):
        from platform_sdk.cache import cached_tool

        @cached_tool(None)
        async def passthrough_tool(x: str) -> str:
            return f"computed:{x}"

        assert await passthrough_tool(x="hello") == "computed:hello"
