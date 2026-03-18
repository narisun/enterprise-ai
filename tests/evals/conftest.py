"""
Eval test conftest — loads fixtures and wires up the LLM judge + rm-prep client.

Environment variables required:
  INTERNAL_API_KEY     — rm-prep API key
  JWT_SECRET           — for signing persona JWTs
  RM_PREP_URL          — default http://localhost:8003
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


# ── rm-prep HTTP client ────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def rm_prep_url() -> str:
    return os.environ.get("RM_PREP_URL", "http://localhost:8003")


@pytest.fixture(scope="session")
def api_key() -> str:
    return os.environ.get("INTERNAL_API_KEY", "test-key")


@pytest.fixture(scope="session")
def jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "test-secret-change-in-prod")


@pytest_asyncio.fixture(scope="session")
async def rm_prep_client(rm_prep_url, api_key):
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(base_url=rm_prep_url, headers=headers, timeout=180.0) as client:
        yield client


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


# ── Helper: run a brief via /brief/persona ─────────────────────────────────────

async def run_brief(rm_prep_client, prompt: str, jwt_token: str) -> str:
    """
    POST to /brief/persona and return the brief_markdown.
    Raises AssertionError if the HTTP call fails.
    """
    resp = await rm_prep_client.post(
        "/brief/persona",
        json={
            "prompt":     prompt,
            "rm_id":      "eval-runner",
            "session_id": f"eval-{int(time.time())}",
            "jwt_token":  jwt_token,
        },
    )
    assert resp.status_code == 200, f"Brief call failed: {resp.status_code} — {resp.text[:300]}"
    return resp.json()["brief_markdown"]


@pytest.fixture(scope="session")
def brief_runner(rm_prep_client, make_jwt):
    """
    Session-scoped factory: brief_runner(fixture) → brief_markdown string.
    Caches results per fixture name to avoid redundant LLM calls during a test run.
    """
    _cache: dict[str, str] = {}

    async def _run(fixture: dict) -> str:
        key = fixture.get("client_name", "") + fixture.get("persona", "")
        if key in _cache:
            return _cache[key]

        from tests.integration.conftest import (
            PERSONA_MANAGER, PERSONA_SENIOR_RM, PERSONA_RM, PERSONA_READONLY
        )
        persona_map = {
            "manager":   PERSONA_MANAGER,
            "senior_rm": PERSONA_SENIOR_RM,
            "rm":        PERSONA_RM,
            "readonly":  PERSONA_READONLY,
        }
        persona_name = fixture.get("persona", "manager")
        persona_data = persona_map[persona_name]
        token = make_jwt(persona_data)

        brief = await run_brief(rm_prep_client, fixture["prompt"], token)
        _cache[key] = brief
        return brief

    return _run
