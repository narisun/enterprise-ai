"""
Dependency Injection Container — continuous_embedding_pipeline
==============================================================

Central wiring for every external dependency.  No service class ever
instantiates its own clients, models, or configuration objects.

Usage
-----
::

    from src.container import ServiceContainer

    container = ServiceContainer()
    container.config.from_pydantic(get_settings())
    container.wire(modules=["src.mining.hard_negatives", "src.training.trainer", ...])

    trainer = container.embedding_trainer()
    trainer.fit(pairs)
"""

from __future__ import annotations

from dependency_injector import containers, providers

from src.config import PipelineSettings, get_settings
from src.evaluation.ragas_gate import RAGASGate
from src.mining.hard_negatives import HardNegativeMiner
from src.training.trainer import EmbeddingTrainer


# Thin wrapper factories for heavy external clients.
# Container owns every third-party SDK import; tests override these providers.


def _build_pgvector_client(dsn: str, collection: str):
    """
    Factory for an async pgvector / LangChain PGVector store.

    In production this returns a real ``PGVector`` instance;
    the container exposes it as a Singleton so only one pool is created.
    """
    from langchain_community.vectorstores import PGVector

    return PGVector(
        connection_string=dsn,
        collection_name=collection,
        pre_delete_collection=False,
    )


def _build_sentence_transformer(model_name: str, device: str | None):
    """Factory for the base SentenceTransformer model."""
    from sentence_transformers import SentenceTransformer

    kwargs: dict = {"model_name_or_path": model_name}
    if device:
        kwargs["device"] = device
    return SentenceTransformer(**kwargs)


def _build_langfuse_client(public_key: str, secret_key: str, host: str):
    """Factory for the LangFuse observability client."""
    from langfuse import Langfuse

    return Langfuse(
        public_key=public_key,
        secret_key=secret_key,
        host=host,
    )


# DI Container


class ServiceContainer(containers.DeclarativeContainer):
    """
    Root DI container.

    Every leaf provider depends on ``settings`` — the fail-fast
    ``PipelineSettings`` singleton that crashes on missing env vars.
    """

    wiring_config = containers.WiringConfiguration(
        modules=[
            "src.mining.hard_negatives",
            "src.training.trainer",
            "src.evaluation.ragas_gate",
        ],
    )

    # Configuration
    settings: providers.Singleton[PipelineSettings] = providers.Singleton(
        get_settings,
    )

    # Infrastructure clients
    pgvector_store = providers.Singleton(
        _build_pgvector_client,
        dsn=settings.provided.pgvector_dsn,
        collection=settings.provided.pgvector_collection,
    )

    base_model = providers.Singleton(
        _build_sentence_transformer,
        model_name=settings.provided.base_model_name,
        device=settings.provided.device,
    )

    langfuse_client = providers.Singleton(
        _build_langfuse_client,
        public_key=settings.provided.langfuse_public_key,
        secret_key=settings.provided.langfuse_secret_key,
        host=settings.provided.langfuse_host,
    )

    # Domain services
    hard_negative_miner: providers.Factory[HardNegativeMiner] = providers.Factory(
        HardNegativeMiner,
        pgvector_store=pgvector_store,
        settings=settings,
    )

    embedding_trainer: providers.Factory[EmbeddingTrainer] = providers.Factory(
        EmbeddingTrainer,
        base_model=base_model,
        settings=settings,
        langfuse_client=langfuse_client,
    )

    ragas_gate: providers.Factory[RAGASGate] = providers.Factory(
        RAGASGate,
        settings=settings,
        langfuse_client=langfuse_client,
    )
