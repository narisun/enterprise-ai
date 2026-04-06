"""
Unit Tests — Hard-Negative Mining
===================================

All tests run offline (no pgvector, no GPU).  The mock store
is injected via conftest fixtures.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from src.domain.models import DomainCategory, MiningResult
from src.mining.hard_negatives import HardNegativeMiner
from tests.conftest import FakeDocument


class TestHardNegativeMiner:
    """Verify mining logic respects similarity floor/ceiling bands."""

    def test_mine_returns_mining_result(
        self,
        mock_pgvector_store: MagicMock,
        test_settings,
    ) -> None:
        miner = HardNegativeMiner(
            pgvector_store=mock_pgvector_store,
            settings=test_settings,
        )
        queries = [
            (
                "What is the ACH return code for insufficient funds?",
                "Return Reason Code R01 — Insufficient Funds.",
                DomainCategory.ACH_TRANSACTION,
            ),
        ]
        result = miner.mine(queries)
        assert isinstance(result, MiningResult)

    def test_mine_accepts_within_band(
        self,
        mock_pgvector_store: MagicMock,
        test_settings,
    ) -> None:
        """Only the neighbour at score=0.68 should survive the band filter."""
        miner = HardNegativeMiner(
            pgvector_store=mock_pgvector_store,
            settings=test_settings,
        )
        queries = [
            (
                "What is the ACH return code for insufficient funds?",
                "Return Reason Code R01 — Insufficient Funds in the originating account.",
                DomainCategory.ACH_TRANSACTION,
            ),
        ]
        result = miner.mine(queries)

        # Exactly one pair accepted (score=0.68 is inside default 0.45–0.85).
        assert result.pairs_accepted == 1
        assert result.pairs_rejected_above_ceiling >= 1  # score=0.92
        assert result.pairs_rejected_below_floor >= 1  # score=0.30

    def test_mine_rejects_positive_itself(
        self,
        test_settings,
    ) -> None:
        """If the positive text appears as a neighbour, it must be skipped."""
        positive_text = "Exact positive passage."
        store = MagicMock()
        store.similarity_search_with_score.return_value = [
            (FakeDocument(page_content=positive_text, metadata={}), 0.70),
        ]

        miner = HardNegativeMiner(pgvector_store=store, settings=test_settings)
        result = miner.mine([
            ("query", positive_text, DomainCategory.GENERAL_BANKING),
        ])
        assert result.pairs_accepted == 0

    def test_mine_empty_queries(
        self,
        mock_pgvector_store: MagicMock,
        test_settings,
    ) -> None:
        miner = HardNegativeMiner(
            pgvector_store=mock_pgvector_store,
            settings=test_settings,
        )
        result = miner.mine([])
        assert result.total_queries_processed == 0
        assert result.acceptance_rate == 0.0

    def test_acceptance_rate_calculation(
        self,
        mock_pgvector_store: MagicMock,
        test_settings,
    ) -> None:
        miner = HardNegativeMiner(
            pgvector_store=mock_pgvector_store,
            settings=test_settings,
        )
        queries = [
            (
                "What is the ACH return code for insufficient funds?",
                "Return Reason Code R01 — Insufficient Funds in the originating account.",
                DomainCategory.ACH_TRANSACTION,
            ),
        ]
        result = miner.mine(queries)
        assert 0.0 < result.acceptance_rate < 1.0

    def test_source_system_extracted(
        self,
        mock_pgvector_store: MagicMock,
        test_settings,
    ) -> None:
        miner = HardNegativeMiner(
            pgvector_store=mock_pgvector_store,
            settings=test_settings,
        )
        queries = [
            (
                "What is ACH R01?",
                "Return Reason Code R01 — Insufficient Funds in the originating account.",
                DomainCategory.ACH_TRANSACTION,
            ),
        ]
        result = miner.mine(queries)
        for pair in result.pairs:
            assert pair.source_system is not None
