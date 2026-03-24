"""
Configuration for the researcher agent.
All settings are loaded from environment variables with sensible defaults.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class ResearcherConfig:
    """Configuration for the researcher deep agent."""

    # LLM settings
    model: str = field(
        default_factory=lambda: os.environ.get("RESEARCHER_MODEL", "gpt-4o")
    )
    temperature: float = field(
        default_factory=lambda: float(os.environ.get("RESEARCHER_TEMPERATURE", "0.1"))
    )

    # Server settings
    host: str = field(
        default_factory=lambda: os.environ.get("RESEARCHER_HOST", "0.0.0.0")
    )
    port: int = field(
        default_factory=lambda: int(os.environ.get("RESEARCHER_PORT", "8100"))
    )

    # Agent settings
    recursion_limit: int = field(
        default_factory=lambda: int(os.environ.get("RESEARCHER_RECURSION_LIMIT", "50"))
    )
    max_search_results: int = field(
        default_factory=lambda: int(os.environ.get("RESEARCHER_MAX_SEARCH_RESULTS", "5"))
    )

    # API keys (validated at startup)
    openai_api_key: str = field(
        default_factory=lambda: os.environ.get("OPENAI_API_KEY", "")
    )


def load_config() -> ResearcherConfig:
    return ResearcherConfig()
