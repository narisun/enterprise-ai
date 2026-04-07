"""
Embedding Trainer — continuous_embedding_pipeline
==================================================

Wraps SentenceTransformers to fine-tune a base embedding model
using **Multiple Negatives Ranking Loss (MNRL)** on banking-domain
training pairs.

Every heavy dependency (model, tracer, hyperparameters) is
injected — nothing is self-instantiated.

Observability: Uses OpenTelemetry spans (vendor-agnostic). The OTel
Collector routes traces to the configured backend (LangFuse, Datadog, etc).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, Sequence

from opentelemetry import trace
from src.domain.models import TrainingPair

if TYPE_CHECKING:
    from src.config import PipelineSettings

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)


# Protocols for injected collaborators


class SentenceTransformerProtocol(Protocol):
    """Structural sub-type for the real ``SentenceTransformer``."""

    def fit(
        self,
        train_objectives: list,
        epochs: int,
        warmup_steps: int,
        output_path: str,
        **kwargs,
    ) -> None:
        ...

    def encode(self, sentences: list[str], **kwargs) -> list:
        ...


class EmbeddingTrainer:
    """
    Fine-tunes a SentenceTransformer model on domain-specific triplets
    using MNRL.

    Parameters
    ----------
    base_model : SentenceTransformerProtocol
        The pre-trained model to fine-tune (injected).
    settings : PipelineSettings
        Validated hyperparameters and paths.
    """

    def __init__(
        self,
        base_model: SentenceTransformerProtocol,
        settings: PipelineSettings,
    ) -> None:
        self._model = base_model
        self._settings = settings

    # Public API

    def fit(self, pairs: Sequence[TrainingPair]) -> Path:
        """
        Run the MNRL fine-tuning loop and persist the checkpoint.

        Parameters
        ----------
        pairs
            The training triplets produced by the hard-negative miner.

        Returns
        -------
        Path
            The directory where the fine-tuned model was saved.
        """
        from sentence_transformers import InputExample, losses
        from torch.utils.data import DataLoader

        output_path = Path(self._settings.finetuned_model_output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        examples = self._build_examples(pairs)

        loader = DataLoader(
            examples,
            batch_size=self._settings.train_batch_size,
            shuffle=True,
        )

        loss = losses.MultipleNegativesRankingLoss(model=self._model)

        total_steps = len(loader) * self._settings.num_epochs
        warmup_steps = int(total_steps * self._settings.warmup_ratio)

        with tracer.start_as_current_span("embedding_finetune") as span:
            span.set_attribute("model.base_name", self._settings.base_model_name)
            span.set_attribute("training.num_pairs", len(pairs))
            span.set_attribute("training.epochs", self._settings.num_epochs)
            span.set_attribute("training.learning_rate", self._settings.learning_rate)
            span.set_attribute("training.warmup_steps", warmup_steps)

        logger.info(
            "Starting MNRL fine-tune: %d examples, %d epochs, lr=%.2e, "
            "warmup=%d steps",
            len(examples),
            self._settings.num_epochs,
            self._settings.learning_rate,
            warmup_steps,
        )

        self._model.fit(
            train_objectives=[(loader, loss)],
            epochs=self._settings.num_epochs,
            warmup_steps=warmup_steps,
            output_path=str(output_path),
            optimizer_params={"lr": self._settings.learning_rate},
            seed=self._settings.seed,
        )

        logger.info("Model checkpoint saved to %s", output_path)
        return output_path

    # Internals

    @staticmethod
    def _build_examples(pairs: Sequence[TrainingPair]) -> list:
        """
        Convert domain ``TrainingPair`` objects into SentenceTransformers
        ``InputExample`` triplets (anchor, positive, hard_negative).
        """
        from sentence_transformers import InputExample

        return [
            InputExample(
                texts=[pair.query, pair.positive, pair.hard_negative],
            )
            for pair in pairs
        ]
