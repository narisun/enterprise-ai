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


# ── Canned persona payloads (mirror _TEST_PERSONAS in server.py) ───────────────

PERSONA_MANAGER = {
    "sub":                  "test-manager-001",
    "name":                 "Alice Manager (test)",
    "role":                 "manager",
    "team_id":              "test-team",
    "assigned_account_ids": [],
    "compliance_clearance": ["standard", "aml_view", "compliance_full"],
}

PERSONA_SENIOR_RM = {
    "sub":                  "test-senior-rm-001",
    "name":                 "Bob Senior RM (test)",
    "role":                 "senior_rm",
    "team_id":              "test-team",
    "assigned_account_ids": [],
    "compliance_clearance": ["standard", "aml_view"],
}

PERSONA_RM = {
    "sub":                  "test-rm-001",
    "name":                 "Carol RM (test)",
    "role":                 "rm",
    "team_id":              "test-team",
    "assigned_account_ids": ["001000000000001AAA", "001000000000002AAA"],
    "compliance_clearance": ["standard"],
}

PERSONA_READONLY = {
    "sub":                  "test-readonly-001",
    "name":                 "Dave Readonly (test)",
    "role":                 "readonly",
    "team_id":              "test-team",
    "assigned_account_ids": [],
    "compliance_clearance": ["standard"],
}
