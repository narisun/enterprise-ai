"""
Root conftest — shared fixtures available to all test layers.

Provides lightweight helpers (JWT creation, env variables) that have
no external dependencies.  Database connections and HTTP clients live
in tests/integration/conftest.py to keep unit tests fast.
"""
import os
import time

import pytest


# ── Environment ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "test-secret-change-in-prod")


@pytest.fixture(scope="session")
def hmac_secret() -> str:
    return os.environ.get("CONTEXT_HMAC_SECRET", "test-context-secret-change-in-prod")


@pytest.fixture(scope="session")
def internal_api_key() -> str:
    return os.environ.get("INTERNAL_API_KEY", "test-key")


# ── JWT factory ────────────────────────────────────────────────────────────────

def _make_jwt(payload: dict, secret: str) -> str:
    """Encode a JWT with HS256. Used by multiple test layers."""
    import jwt as pyjwt
    now = int(time.time())
    return pyjwt.encode(
        {"iat": now, "exp": now + 3600, **payload},
        secret,
        algorithm="HS256",
    )


@pytest.fixture(scope="session")
def make_persona_jwt(jwt_secret):
    """Factory fixture: call make_persona_jwt(persona_dict) → JWT string."""
    def _make(persona: dict) -> str:
        return _make_jwt(persona, jwt_secret)
    return _make


# ── Canned persona payloads — derived from platform_sdk.testing ────────────────
# Single source of truth: platform_sdk.testing.TEST_PERSONAS
# These dicts are JWT-shaped (sub/name) for make_persona_jwt().

from platform_sdk.testing import TEST_PERSONAS


def _persona_to_jwt_payload(persona: dict) -> dict:
    """Convert a TEST_PERSONAS entry to a JWT claim set."""
    return {
        "sub":                  persona["rm_id"],
        "name":                 persona["rm_name"],
        "role":                 persona["role"],
        "team_id":              persona["team_id"],
        "assigned_account_ids": persona["assigned_account_ids"],
        "compliance_clearance": persona["compliance_clearance"],
    }


PERSONA_MANAGER   = _persona_to_jwt_payload(TEST_PERSONAS["manager"])
PERSONA_SENIOR_RM = _persona_to_jwt_payload(TEST_PERSONAS["senior_rm"])
PERSONA_RM        = _persona_to_jwt_payload(TEST_PERSONAS["rm"])
PERSONA_READONLY  = _persona_to_jwt_payload(TEST_PERSONAS["readonly"])
