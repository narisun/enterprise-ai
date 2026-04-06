"""
Hard-Negative Mining — continuous_embedding_pipeline
=====================================================

Queries pgvector for nearest-neighbour passages that are semantically
close to each anchor query *but do not match the labelled positive*.
These "almost-right" passages become hard negatives for MNRL training,
forcing the model to learn the fine-grained distinctions in banking
and CRM vocabulary.

Design notes
------------
* Zero self-instantiation — ``pgvector_store`` and ``settings`` are
  injected by the DI container.
* All I/O is async-ready; the public API returns plain dataclasses.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Protocol, Sequence

from src.domain.models import (
    DomainCategory,
    MiningResult,
    TrainingPair,
)

if TYPE_CHECKING:
    from src.config import PipelineSettings

logger = logging.getLogger(__name__)


# Vector store protocol

class VectorStoreProtocol(Protocol):
    """Structural sub-type so tests can supply any duck-typed fake."""

    def similarity_search_with_score(
        self,
        query: str,
        k: int,
    ) -> list[tuple]:  # list[tuple[Document, float]]
        ...


class HardNegativeMiner:
    """
    Mine hard-negative passages from a pgvector collection.

    Parameters
    ----------
    pgvector_store : VectorStoreProtocol
        An injected LangChain-compatible vector store.
    settings : PipelineSettings
        Fail-fast validated configuration.
    """

    def __init__(
        self,
        pgvector_store: VectorStoreProtocol,
        settings: PipelineSettings,
    ) -> None:
        self._store = pgvector_store
        self._top_k = settings.hard_negative_top_k
        self._sim_floor = settings.hard_negative_similarity_floor
        self._sim_ceiling = settings.hard_negative_similarity_ceiling

    # Public API

    def mine(
        self,
        queries: Sequence[tuple[str, str, DomainCategory]],
    ) -> MiningResult:
        """
        For each ``(query, positive_text, domain)`` triple, retrieve the
        top-K neighbours from pgvector and select those that land in the
        hard-negative similarity band.

        Parameters
        ----------
        queries
            Iterable of (anchor_query, known_positive_text, domain_category).

        Returns
        -------
        MiningResult
            Contains the accepted ``TrainingPair`` list and diagnostics.
        """
        result = MiningResult()

        for query_text, positive_text, domain in queries:
            result.total_queries_processed += 1
            neighbours = self._store.similarity_search_with_score(
                query=query_text,
                k=self._top_k,
            )

            for doc, score in neighbours:
                result.candidates_evaluated += 1

                # Skip the positive itself (exact or near-exact match).
                if self._is_positive(doc, positive_text):
                    continue

                if score < self._sim_floor:
                    result.pairs_rejected_below_floor += 1
                    continue

                if score > self._sim_ceiling:
                    result.pairs_rejected_above_ceiling += 1
                    continue

                # Accepted hard negative.
                pair = TrainingPair(
                    query=query_text,
                    positive=positive_text,
                    hard_negative=self._extract_text(doc),
                    domain_category=domain,
                    source_system=self._extract_source(doc),
                )
                result.pairs.append(pair)
                result.pairs_accepted += 1

        logger.info(
            "Hard-negative mining complete: %d pairs from %d queries "
            "(acceptance rate %.2f%%)",
            result.pairs_accepted,
            result.total_queries_processed,
            result.acceptance_rate * 100,
        )
        return result

    # Internals

    @staticmethod
    def _is_positive(doc, positive_text: str) -> bool:
        """Return True if *doc* is the known positive (avoid self-negatives)."""
        text = doc.page_content if hasattr(doc, "page_content") else str(doc)
        return text.strip() == positive_text.strip()

    @staticmethod
    def _extract_text(doc) -> str:
        return doc.page_content if hasattr(doc, "page_content") else str(doc)

    @staticmethod
    def _extract_source(doc) -> str | None:
        if hasattr(doc, "metadata") and isinstance(doc.metadata, dict):
            return doc.metadata.get("source_system")
        return None
