"""
Fail-Fast Configuration — continuous_embedding_pipeline
========================================================

Every mandatory environment variable is validated at import time via
pydantic-settings.  A missing or malformed value raises
``ValidationError`` and crashes the process before any work begins.

Usage in business logic:
    settings = get_settings()          # cached singleton
    print(settings.pgvector_dsn)       # Pydantic-validated str

Never call ``os.getenv()`` directly in service code.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class PipelineSettings(BaseSettings):
    """Immutable, validated envelope for every knob the service exposes."""

    model_config = SettingsConfigDict(
        env_prefix="CEP_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Infrastructure
    pgvector_dsn: str = Field(
        ...,
        description=(
            "PostgreSQL+pgvector connection string. "
            "Example: postgresql+asyncpg://user:pass@host:5432/embeddings"
        ),
    )
    pgvector_collection: str = Field(
        ...,
        description="pgvector collection / table name for embedding vectors.",
    )

    # Observability
    langfuse_public_key: str = Field(
        ..., description="LangFuse public API key for tracing."
    )
    langfuse_secret_key: str = Field(
        ..., description="LangFuse secret API key for tracing."
    )
    langfuse_host: str = Field(
        default="https://cloud.langfuse.com",
        description="LangFuse host endpoint.",
    )

    # Model & Training Hyperparameters
    base_model_name: str = Field(
        ...,
        description=(
            "HuggingFace model identifier for the base embedding model. "
            "Example: BAAI/bge-base-en-v1.5"
        ),
    )
    finetuned_model_output_dir: str = Field(
        ...,
        description="Local or S3 path where the fine-tuned checkpoint is saved.",
    )
    learning_rate: float = Field(
        ...,
        gt=0.0,
        le=1.0,
        description="AdamW learning rate for MNRL fine-tuning.",
    )
    train_batch_size: int = Field(
        default=64,
        gt=0,
        description="Per-device training batch size.",
    )
    num_epochs: int = Field(
        default=3,
        gt=0,
        description="Number of fine-tuning epochs.",
    )
    warmup_ratio: float = Field(
        default=0.1,
        ge=0.0,
        le=1.0,
        description="Fraction of total steps used for linear warmup.",
    )

    # Hard-Negative Mining
    hard_negative_top_k: int = Field(
        default=50,
        gt=0,
        description=(
            "Number of nearest neighbours to retrieve when mining hard negatives."
        ),
    )
    hard_negative_similarity_floor: float = Field(
        default=0.45,
        ge=0.0,
        le=1.0,
        description=(
            "Minimum cosine similarity for a candidate to be considered "
            "a hard negative (too-low scores are easy negatives)."
        ),
    )
    hard_negative_similarity_ceiling: float = Field(
        default=0.85,
        ge=0.0,
        le=1.0,
        description=(
            "Maximum cosine similarity — candidates above this are "
            "likely true positives, not negatives."
        ),
    )

    # RAGAS Deployment Gate
    golden_set_path: str = Field(
        ...,
        description="Path (local or S3) to the golden evaluation dataset (JSON/Parquet).",
    )
    ragas_context_precision_threshold: float = Field(
        default=0.80,
        ge=0.0,
        le=1.0,
        description="Minimum context precision to pass the deployment gate.",
    )
    ragas_context_recall_threshold: float = Field(
        default=0.75,
        ge=0.0,
        le=1.0,
        description="Minimum context recall to pass the deployment gate.",
    )

    # Optional overrides
    device: Optional[str] = Field(
        default=None,
        description="Force a specific torch device ('cpu', 'cuda:0'). None = auto-detect.",
    )
    seed: int = Field(default=42, description="Global random seed for reproducibility.")

    # Cross-field validators
    @field_validator("hard_negative_similarity_ceiling")
    @classmethod
    def ceiling_above_floor(cls, v: float, info) -> float:  # noqa: N805
        floor = info.data.get("hard_negative_similarity_floor")
        if floor is not None and v <= floor:
            msg = (
                f"hard_negative_similarity_ceiling ({v}) must be strictly "
                f"greater than hard_negative_similarity_floor ({floor})."
            )
            raise ValueError(msg)
        return v


@lru_cache(maxsize=1)
def get_settings() -> PipelineSettings:
    """Return the singleton settings instance (fail-fast on first call)."""
    return PipelineSettings()  # type: ignore[call-arg]
