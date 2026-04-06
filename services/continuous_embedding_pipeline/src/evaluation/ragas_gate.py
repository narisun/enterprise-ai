"""
RAGAS Deployment Gate — continuous_embedding_pipeline
=====================================================

Evaluates a candidate embedding model against the **Golden Set** using
RAGAS context_precision and context_recall metrics.  The verdict
(pass / fail) is consumed by CI/CD to promote or reject a new
embedding checkpoint.

All heavy dependencies (LangFuse, RAGAS, embedding model) are injected.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Protocol, Sequence

from src.domain.models import GateVerdict, GoldenSetEntry

if TYPE_CHECKING:
    from src.config import PipelineSettings

logger = logging.getLogger(__name__)


class LangfuseProtocol(Protocol):
    def trace(self, **kwargs):
        ...


class RAGASGate:
    """
    Run RAGAS benchmarks and emit a pass/fail ``GateVerdict``.

    Parameters
    ----------
    settings : PipelineSettings
        Thresholds and golden-set path.
    langfuse_client : LangfuseProtocol
        Observability tracer.
    """

    def __init__(
        self,
        settings: PipelineSettings,
        langfuse_client: LangfuseProtocol,
    ) -> None:
        self._settings = settings
        self._langfuse = langfuse_client

    # Public API

    def evaluate(
        self,
        golden_set: Sequence[GoldenSetEntry],
        retrieved_contexts: Sequence[list[str]],
    ) -> GateVerdict:
        """
        Run context_precision and context_recall from RAGAS and return a
        deployment verdict.

        Parameters
        ----------
        golden_set
            The curated evaluation entries (questions + ground truths).
        retrieved_contexts
            For each golden-set entry, the list of context passages
            actually retrieved by the candidate model.

        Returns
        -------
        GateVerdict
        """
        from datasets import Dataset
        from ragas import evaluate as ragas_evaluate
        from ragas.metrics import context_precision, context_recall

        if len(golden_set) != len(retrieved_contexts):
            msg = (
                f"golden_set length ({len(golden_set)}) != "
                f"retrieved_contexts length ({len(retrieved_contexts)})"
            )
            raise ValueError(msg)

        eval_data = {
            "question": [e.question for e in golden_set],
            "ground_truth": [e.ground_truth for e in golden_set],
            "contexts": [ctxs for ctxs in retrieved_contexts],
        }
        dataset = Dataset.from_dict(eval_data)

        logger.info(
            "Running RAGAS evaluation on %d samples …", len(golden_set),
        )

        ragas_result = ragas_evaluate(
            dataset=dataset,
            metrics=[context_precision, context_recall],
        )

        cp = float(ragas_result["context_precision"])
        cr = float(ragas_result["context_recall"])

        passed = (
            cp >= self._settings.ragas_context_precision_threshold
            and cr >= self._settings.ragas_context_recall_threshold
        )

        verdict = GateVerdict(
            passed=passed,
            context_precision=cp,
            context_recall=cr,
            precision_threshold=self._settings.ragas_context_precision_threshold,
            recall_threshold=self._settings.ragas_context_recall_threshold,
            num_eval_samples=len(golden_set),
            details=dict(ragas_result),
        )

        self._langfuse.trace(
            name="ragas_deployment_gate",
            metadata={
                "context_precision": cp,
                "context_recall": cr,
                "passed": passed,
                "num_samples": len(golden_set),
            },
        )

        log_fn = logger.info if passed else logger.warning
        log_fn(
            "RAGAS gate %s — precision=%.4f (≥%.4f), recall=%.4f (≥%.4f)",
            "PASSED" if passed else "FAILED",
            cp,
            self._settings.ragas_context_precision_threshold,
            cr,
            self._settings.ragas_context_recall_threshold,
        )

        return verdict
