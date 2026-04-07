"""
Test Fixtures & DI Overrides — continuous_embedding_pipeline
=============================================================

Safely replaces every heavy external dependency (GPU model, pgvector)
with lightweight mocks so the full test suite runs in < 2 seconds
with zero network/GPU/database calls.

Observability is handled via OpenTelemetry — no vendor-specific mocks needed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock

import pytest

from src.config import PipelineSettings
from src.domain.models import DomainCategory, GoldenSetEntry, TrainingPair


# ── Fake settings (all mandatory fields supplied) ─────────────────────────

_TEST_ENV: dict[str, str] = {
    "CEP_PGVECTOR_DSN": "postgresql+asyncpg://test:test@localhost:5432/test_db",
    "CEP_PGVECTOR_COLLECTION": "test_embeddings",
    "CEP_LANGFUSE_PUBLIC_KEY": "pk-test-000",
    "CEP_LANGFUSE_SECRET_KEY": "sk-test-000",
    "CEP_BASE_MODEL_NAME": "sentence-transformers/all-MiniLM-L6-v2",
    "CEP_FINETUNED_MODEL_OUTPUT_DIR": "/tmp/test_model_out",
    "CEP_LEARNING_RATE": "2e-5",
    "CEP_GOLDEN_SET_PATH": "/tmp/golden_set.json",
}


@pytest.fixture()
def test_settings(monkeypatch: pytest.MonkeyPatch) -> PipelineSettings:
    """
    Provide a fully-valid ``PipelineSettings`` without touching real env vars.

    The ``lru_cache`` on ``get_settings()`` is deliberately *not* called here
    so each test gets a fresh instance.
    """
    for key, value in _TEST_ENV.items():
        monkeypatch.setenv(key, value)
    return PipelineSettings()  # type: ignore[call-arg]


# ── Mock pgvector store ───────────────────────────────────────────────────


@dataclass
class FakeDocument:
    """Minimal stand-in for a LangChain ``Document``."""

    page_content: str
    metadata: dict[str, Any]


@pytest.fixture()
def mock_pgvector_store() -> MagicMock:
    """
    A mock vector store whose ``similarity_search_with_score`` returns
    controllable results for hard-negative mining tests.
    """
    store = MagicMock()

    # Default: return three neighbours with varying similarity scores.
    store.similarity_search_with_score.return_value = [
        (
            FakeDocument(
                page_content="ACH Return Code R01 — Insufficient Funds in the originating account.",
                metadata={"source_system": "policy_kb"},
            ),
            0.92,  # above ceiling → rejected
        ),
        (
            FakeDocument(
                page_content="ACH Return Code R03 — No Account / Unable to Locate Account.",
                metadata={"source_system": "policy_kb"},
            ),
            0.68,  # inside band → accepted as hard negative
        ),
        (
            FakeDocument(
                page_content="Wire transfers are processed within 24 hours.",
                metadata={"source_system": "general_faq"},
            ),
            0.30,  # below floor → rejected
        ),
    ]
    return store


# ── Mock SentenceTransformer model ────────────────────────────────────────


@pytest.fixture()
def mock_sentence_transformer() -> MagicMock:
    """A mock that satisfies ``SentenceTransformerProtocol`` without a GPU."""
    model = MagicMock()
    model.fit = MagicMock(return_value=None)
    model.encode = MagicMock(return_value=[[0.1, 0.2, 0.3]])
    return model


# ── Sample training pairs ────────────────────────────────────────────────


@pytest.fixture()
def sample_training_pairs() -> list[TrainingPair]:
    """A small batch of realistic banking-domain training pairs."""
    return [
        TrainingPair(
            query="What is the ACH return code for insufficient funds?",
            positive="Return Reason Code R01 — Insufficient Funds.",
            hard_negative="Return Reason Code R03 — No Account / Unable to Locate Account.",
            domain_category=DomainCategory.ACH_TRANSACTION,
            source_system="policy_kb",
        ),
        TrainingPair(
            query="How do I link a Salesforce Account to a commercial loan application?",
            positive=(
                "Navigate to the Account record, open the Related tab, "
                "and click 'New Loan Application' under Commercial Lending."
            ),
            hard_negative=(
                "Navigate to the Contact record and click 'Log a Call' "
                "to record customer interactions."
            ),
            domain_category=DomainCategory.SALESFORCE_ACCOUNT,
            source_system="salesforce",
        ),
        TrainingPair(
            query="What KYC documents are required for a new business account?",
            positive=(
                "Required KYC documents include: Articles of Incorporation, "
                "EIN confirmation letter, government-issued ID for all beneficial owners, "
                "and proof of business address."
            ),
            hard_negative=(
                "For personal accounts, a single government-issued photo ID "
                "and proof of address are sufficient."
            ),
            domain_category=DomainCategory.KYC_AML,
            source_system="policy_kb",
        ),
    ]


# ── Sample golden set ────────────────────────────────────────────────────


@pytest.fixture()
def sample_golden_set() -> list[GoldenSetEntry]:
    return [
        GoldenSetEntry(
            question="What happens when an ACH payment is returned with code R01?",
            ground_truth="The payment is returned due to insufficient funds in the originator's account.",
            contexts=[
                "ACH Return Reason Code R01 — Insufficient Funds.",
                "The RDFI returns the entry because the available balance is not sufficient.",
            ],
            domain_category=DomainCategory.ACH_TRANSACTION,
        ),
        GoldenSetEntry(
            question="How is a Salesforce Opportunity linked to a deposit product?",
            ground_truth="Through the Product field on the Opportunity record mapped to the Deposit Product catalog.",
            contexts=[
                "Each Opportunity record contains a Product lookup field.",
                "The Deposit Product catalog is synced nightly from the core banking system.",
            ],
            domain_category=DomainCategory.SALESFORCE_OPPORTUNITY,
        ),
    ]
