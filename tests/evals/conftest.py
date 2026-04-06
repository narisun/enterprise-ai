"""
Eval test conftest — loads fixtures and wires up the LLM judge.

Environment variables required:
  INTERNAL_API_KEY     — API key for services
  JWT_SECRET           — for signing persona JWTs
  LITELLM_BASE_URL     — LiteLLM proxy (or OPENAI_API_KEY for direct OpenAI)
  EVAL_JUDGE_MODEL     — judge model name, default gpt-4o-mini
"""
import json
import os
import time
from pathlib import Path

import httpx
import pytest
import pytest_asyncio

from .judge import LLMJudge

FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ── Fixtures loading ───────────────────────────────────────────────────────────

def load_fixture(name: str) -> dict:
    path = FIXTURES_DIR / name
    with open(path) as f:
        return json.load(f)


@pytest.fixture(scope="session")
def fixture_microsoft_manager() -> dict:
    return load_fixture("case_001_microsoft_manager.json")


@pytest.fixture(scope="session")
def fixture_ford_rm() -> dict:
    return load_fixture("case_002_ford_rm_restricted.json")


@pytest.fixture(scope="session")
def fixture_unknown_client() -> dict:
    return load_fixture("case_003_unknown_client.json")


@pytest.fixture(scope="session")
def fixture_readonly() -> dict:
    return load_fixture("case_004_readonly_denied.json")


# ── LLM judge ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def judge() -> LLMJudge:
    return LLMJudge.from_env()


@pytest.fixture(scope="session")
def api_key() -> str:
    return os.environ.get("INTERNAL_API_KEY", "test-key")


@pytest.fixture(scope="session")
def jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "test-secret-change-in-prod")


# ── JWT factory ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def make_jwt(jwt_secret):
    def _make(persona: dict) -> str:
        import jwt as pyjwt
        now = int(time.time())
        return pyjwt.encode(
            {**persona, "iat": now, "exp": now + 3600},
            jwt_secret,
            algorithm="HS256",
        )
    return _make


