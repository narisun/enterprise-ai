"""
Domain Models — continuous_embedding_pipeline
==============================================

Pure data structures with zero infrastructure coupling.
These represent the financial-domain training pairs used
throughout the Data Flywheel: mining, training, and evaluation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4


class DomainCategory(str, Enum):
    """High-level categories for banking/CRM vocabulary alignment."""

    SALESFORCE_ACCOUNT = "salesforce_account"
    SALESFORCE_OPPORTUNITY = "salesforce_opportunity"
    SALESFORCE_CONTACT = "salesforce_contact"
    ACH_TRANSACTION = "ach_transaction"
    WIRE_TRANSFER = "wire_transfer"
    RETAIL_COMPLIANCE = "retail_compliance"
    COMMERCIAL_LENDING = "commercial_lending"
    KYC_AML = "kyc_aml"
    DEPOSIT_OPERATIONS = "deposit_operations"
    GENERAL_BANKING = "general_banking"


@dataclass(frozen=True, slots=True)
class TrainingPair:
    """
    A single anchor–positive–hard-negative triplet for MNRL training.

    Attributes
    ----------
    query : str
        Natural-language question or user utterance (the *anchor*).
        Example: "What is the ACH return code for insufficient funds?"
    positive : str
        The semantically correct passage / document chunk.
        Example: "Return Reason Code R01 — Insufficient Funds …"
    hard_negative : str
        A passage that is *superficially similar* but factually wrong for the query.
        Example: "Return Reason Code R03 — No Account / Unable to Locate …"
    domain_category : DomainCategory
        Which banking/CRM sub-domain this pair belongs to.
    pair_id : UUID
        Stable identifier for deduplication and lineage tracking.
    source_system : str | None
        Origin of the positive passage (e.g. "salesforce", "policy_kb").
    """

    query: str
    positive: str
    hard_negative: str
    domain_category: DomainCategory
    pair_id: UUID = field(default_factory=uuid4)
    source_system: Optional[str] = None

    def anchor_positive_texts(self) -> tuple[str, str]:
        """Return the (query, positive) pair for contrastive training."""
        return self.query, self.positive


@dataclass(frozen=True, slots=True)
class GoldenSetEntry:
    """
    A single row from the Golden Evaluation Set used for RAGAS gating.

    Attributes
    ----------
    question : str
        The evaluation question.
    ground_truth : str
        The expected answer text.
    contexts : list[str]
        The reference context passages that should be retrieved.
    domain_category : DomainCategory
        Sub-domain label for stratified evaluation reporting.
    """

    question: str
    ground_truth: str
    contexts: list[str] = field(default_factory=list)
    domain_category: DomainCategory = DomainCategory.GENERAL_BANKING


@dataclass(slots=True)
class MiningResult:
    """
    Output produced by the hard-negative mining stage.

    Carries both the generated training pairs and diagnostic metadata
    so the orchestrator can decide whether to proceed to training.
    """

    pairs: list[TrainingPair] = field(default_factory=list)
    total_queries_processed: int = 0
    candidates_evaluated: int = 0
    pairs_accepted: int = 0
    pairs_rejected_below_floor: int = 0
    pairs_rejected_above_ceiling: int = 0

    @property
    def acceptance_rate(self) -> float:
        if self.candidates_evaluated == 0:
            return 0.0
        return self.pairs_accepted / self.candidates_evaluated


@dataclass(frozen=True, slots=True)
class GateVerdict:
    """
    The output of the RAGAS deployment gate.

    ``passed`` is the single boolean the CI/CD pipeline consumes.
    """

    passed: bool
    context_precision: float
    context_recall: float
    precision_threshold: float
    recall_threshold: float
    num_eval_samples: int
    details: Optional[dict] = None
