"""
Unit Tests — Embedding Trainer
================================

All tests run offline — the real SentenceTransformer model and GPU
are replaced with MagicMocks injected through conftest fixtures.

Because ``trainer.py`` uses *lazy imports* inside ``fit()``
(``from sentence_transformers import …``), patches target the
third-party modules directly so the local names resolve to mocks.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

import pytest

from src.domain.models import DomainCategory, TrainingPair
from src.training.trainer import EmbeddingTrainer


# ── Helpers to fake heavy third-party modules ─────────────────────────────


@pytest.fixture(autouse=True)
def _fake_heavy_modules(monkeypatch: pytest.MonkeyPatch):
    """
    Insert lightweight stubs for ``sentence_transformers`` and
    ``torch.utils.data`` into ``sys.modules`` so the lazy imports
    inside ``EmbeddingTrainer.fit`` never touch real packages.
    """
    # -- sentence_transformers stub --
    st_mod = ModuleType("sentence_transformers")

    mock_ie_cls = MagicMock()
    mock_ie_cls.side_effect = lambda texts: texts  # passthrough
    st_mod.InputExample = mock_ie_cls

    losses_mod = ModuleType("sentence_transformers.losses")
    mock_mnrl = MagicMock()
    losses_mod.MultipleNegativesRankingLoss = mock_mnrl
    st_mod.losses = losses_mod

    # -- torch.utils.data stub --
    torch_mod = ModuleType("torch")
    torch_utils = ModuleType("torch.utils")
    torch_data = ModuleType("torch.utils.data")
    mock_loader_cls = MagicMock()
    mock_loader_instance = MagicMock()
    mock_loader_instance.__len__ = MagicMock(return_value=1)
    mock_loader_cls.return_value = mock_loader_instance
    torch_data.DataLoader = mock_loader_cls
    torch_utils.data = torch_data
    torch_mod.utils = torch_utils

    # Reproducibility attributes accessed in EmbeddingTrainer.__init__
    torch_mod.manual_seed = MagicMock()
    torch_cuda = ModuleType("torch.cuda")
    torch_cuda.is_available = MagicMock(return_value=False)
    torch_cuda.manual_seed_all = MagicMock()
    torch_mod.cuda = torch_cuda
    torch_backends = ModuleType("torch.backends")
    torch_backends_cudnn = ModuleType("torch.backends.cudnn")
    torch_backends_cudnn.deterministic = False
    torch_backends_cudnn.benchmark = True
    torch_backends.cudnn = torch_backends_cudnn
    torch_mod.backends = torch_backends

    monkeypatch.setitem(sys.modules, "sentence_transformers", st_mod)
    monkeypatch.setitem(sys.modules, "sentence_transformers.losses", losses_mod)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    monkeypatch.setitem(sys.modules, "torch.utils", torch_utils)
    monkeypatch.setitem(sys.modules, "torch.utils.data", torch_data)

    yield

    # Fixture tears down via monkeypatch automatically.


# ── Tests ─────────────────────────────────────────────────────────────────


class TestEmbeddingTrainer:
    """Verify the training orchestration logic without a real GPU."""

    def test_fit_calls_model_fit(
        self,
        mock_sentence_transformer: MagicMock,
        test_settings,
        sample_training_pairs: list[TrainingPair],
        tmp_path: Path,
    ) -> None:
        """The trainer must delegate to ``model.fit()`` exactly once."""
        test_settings.finetuned_model_output_dir = str(tmp_path / "model_out")

        trainer = EmbeddingTrainer(
            base_model=mock_sentence_transformer,
            settings=test_settings,
        )
        result_path = trainer.fit(sample_training_pairs)

        mock_sentence_transformer.fit.assert_called_once()
        assert result_path == tmp_path / "model_out"

    def test_fit_emits_otel_span(
        self,
        mock_sentence_transformer: MagicMock,
        test_settings,
        sample_training_pairs: list[TrainingPair],
        tmp_path: Path,
    ) -> None:
        """Every training run must produce an OTel span named 'embedding_finetune'."""
        from unittest.mock import patch

        test_settings.finetuned_model_output_dir = str(tmp_path / "model_out")

        mock_span = MagicMock()
        mock_context = MagicMock()
        mock_context.__enter__ = MagicMock(return_value=mock_span)
        mock_context.__exit__ = MagicMock(return_value=False)

        with patch("src.training.trainer.tracer") as mock_tracer:
            mock_tracer.start_as_current_span.return_value = mock_context

            trainer = EmbeddingTrainer(
                base_model=mock_sentence_transformer,
                settings=test_settings,
            )
            trainer.fit(sample_training_pairs)

            mock_tracer.start_as_current_span.assert_called_once_with("embedding_finetune")
            mock_span.set_attribute.assert_any_call("training.num_pairs", len(sample_training_pairs))

    def test_fit_creates_output_directory(
        self,
        mock_sentence_transformer: MagicMock,
        test_settings,
        sample_training_pairs: list[TrainingPair],
        tmp_path: Path,
    ) -> None:
        """The trainer must create the output directory if it doesn't exist."""
        nested_dir = tmp_path / "deep" / "nested" / "model_out"
        test_settings.finetuned_model_output_dir = str(nested_dir)

        trainer = EmbeddingTrainer(
            base_model=mock_sentence_transformer,
            settings=test_settings,
        )
        trainer.fit(sample_training_pairs)

        assert nested_dir.exists()

    def test_build_examples_returns_correct_count(
        self,
        sample_training_pairs: list[TrainingPair],
    ) -> None:
        """Static helper must produce one InputExample per TrainingPair."""
        examples = EmbeddingTrainer._build_examples(sample_training_pairs)
        assert len(examples) == len(sample_training_pairs)

    def test_fit_passes_correct_hyperparameters(
        self,
        mock_sentence_transformer: MagicMock,
        test_settings,
        sample_training_pairs: list[TrainingPair],
        tmp_path: Path,
    ) -> None:
        """Verify learning rate and epochs are forwarded to model.fit()."""
        test_settings.finetuned_model_output_dir = str(tmp_path / "model_out")

        trainer = EmbeddingTrainer(
            base_model=mock_sentence_transformer,
            settings=test_settings,
        )
        trainer.fit(sample_training_pairs)

        call_kwargs = mock_sentence_transformer.fit.call_args.kwargs
        assert call_kwargs["epochs"] == test_settings.num_epochs
        assert call_kwargs["optimizer_params"]["lr"] == test_settings.learning_rate
        assert call_kwargs["seed"] == test_settings.seed

    def test_fit_with_empty_pairs(
        self,
        mock_sentence_transformer: MagicMock,
        test_settings,
        tmp_path: Path,
    ) -> None:
        """Training with zero pairs should still invoke model.fit()."""
        test_settings.finetuned_model_output_dir = str(tmp_path / "model_out")

        trainer = EmbeddingTrainer(
            base_model=mock_sentence_transformer,
            settings=test_settings,
        )
        trainer.fit([])

        mock_sentence_transformer.fit.assert_called_once()
