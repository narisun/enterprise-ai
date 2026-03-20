"""
Test JWT fixtures for RM Prep authorization testing.

Generates signed JWTs for each test persona.  Use these tokens in:
  - Integration tests via pytest fixtures
  - Manual Streamlit testing (paste token in debug panel)
  - curl / httpx tests against the /brief endpoint

Usage:
    from tests.fixtures.test_tokens import get_token, PERSONAS

    # In a test:
    token = get_token("alice_rm")
    resp = httpx.post("/brief", headers={"Authorization": f"Bearer {token}"}, json={...})

    # Print all tokens for manual testing:
    python tests/fixtures/test_tokens.py
"""
from __future__ import annotations

import os
import time
from typing import Any

JWT_SECRET = os.environ.get("JWT_SECRET", "test-secret-change-in-prod")
JWT_ALGORITHM = "HS256"

# ─── Persona Definitions ─────────────────────────────────────────────────────
# Each persona represents a realistic RM role with appropriate data access.
# The assigned_account_ids correspond to actual IDs in sfcrm/Account.csv

PERSONAS: dict[str, dict[str, Any]] = {

    # Standard RM — restricted to 4 assigned Fortune 500 accounts
    # Tests: row-level filtering, AML masking, unassigned-account denial
    "alice_rm": {
        "sub": "rm-001",
        "name": "Alice Chen",
        "role": "rm",
        "team_id": "treasury-west",
        "assigned_account_ids": [
            "001000000000001AAA",   # Microsoft Corp. — KYC:Enhanced, AML:Medium, Risk:Moderate
            "001000000000002AAA",   # Ford Motor Company — KYC:Enhanced, AML:Medium, Risk:Low
            "001000000000014AAA",   # Amazon.com, Inc. — KYC:Enhanced, AML:Low, Risk:High
            "001000000000006AAA",   # Delta Air Lines — KYC:Pending, AML:High, Risk:High
        ],
        "compliance_clearance": ["standard"],
    },

    # RM with single account — tests minimal book of business
    "eve_rm_single": {
        "sub": "rm-003",
        "name": "Eve Martinez",
        "role": "rm",
        "team_id": "treasury-east",
        "assigned_account_ids": [
            "001000000000028AAA",   # Kroger — KYC:Enhanced, AML:High, Risk:High (PEP-flagged)
        ],
        "compliance_clearance": ["standard"],
    },

    # RM with no accounts assigned — all queries should be denied
    "frank_rm_empty": {
        "sub": "rm-004",
        "name": "Frank Wilson",
        "role": "rm",
        "team_id": "treasury-east",
        "assigned_account_ids": [],
        "compliance_clearance": ["standard"],
    },

    # Senior RM — no row restriction, AML fields visible
    # Tests: cross-account access, aml_view clearance, broad portfolio
    "bob_senior_rm": {
        "sub": "rm-002",
        "name": "Bob Singh",
        "role": "senior_rm",
        "team_id": "treasury-west",
        "assigned_account_ids": [],
        "compliance_clearance": ["standard", "aml_view"],
    },

    # Manager — no row restriction, aml_view clearance
    # Tests: full portfolio access, same column access as senior_rm
    "carol_manager": {
        "sub": "mgr-001",
        "name": "Carol Diaz",
        "role": "manager",
        "team_id": "all",
        "assigned_account_ids": [],
        "compliance_clearance": ["standard", "aml_view"],
    },

    # Compliance Officer — no row restriction, full column access including
    # SanctionsScreeningStatus, PEPFlag, BSAAMLProgramRating
    # Tests: compliance_full clearance, sanctions/PEP visibility
    "dan_compliance": {
        "sub": "cmp-001",
        "name": "Dan Park",
        "role": "compliance_officer",
        "team_id": "compliance",
        "assigned_account_ids": [],
        "compliance_clearance": ["standard", "aml_view", "compliance_full"],
    },

    # Read-only observer — should be denied all tool calls
    "grace_readonly": {
        "sub": "obs-001",
        "name": "Grace Lee",
        "role": "readonly",
        "team_id": "audit",
        "assigned_account_ids": [],
        "compliance_clearance": ["standard"],
    },
}

# ─── Companies with interesting compliance profiles for targeted tests ─────────
# Reference these account IDs in tests to trigger specific access control paths.
ACCOUNT_IDS = {
    "microsoft":    "001000000000001AAA",   # AML:Medium, KYC:Enhanced
    "ford":         "001000000000002AAA",   # AML:Medium, KYC:Enhanced
    "sysco":        "001000000000003AAA",   # AML:Low, KYC:Enhanced, Risk:Elevated
    "marathon":     "001000000000004AAA",   # AML:Medium, KYC:Enhanced
    "walgreens":    "001000000000005AAA",   # AML:High, KYC:Pending
    "delta":        "001000000000006AAA",   # AML:High, KYC:Pending, Risk:High
    "general_motors": "001000000000007AAA", # AML:Low, KYC:Complete
    "cvs":          "001000000000008AAA",   # AML:High, KYC:Pending (test sanctions)
    "kroger":       "001000000000028AAA",   # AML:High, KYC:Enhanced, Risk:High, PEP:True
    "intel":        "001000000000024AAA",   # AML:High, Risk:Elevated (PEP:True)
}

# Accounts NOT assigned to alice_rm — used to test denial
ALICE_UNASSIGNED = [
    "001000000000005AAA",   # Walgreens Boots Alliance
    "001000000000007AAA",   # General Motors
    "001000000000008AAA",   # CVS Health
    "001000000000028AAA",   # Kroger (PEP-flagged, High AML)
]


# ─── Token generation ─────────────────────────────────────────────────────────

def get_token(persona_name: str, ttl_seconds: int = 3600) -> str:
    """
    Generate a signed JWT for the named persona.

    Args:
        persona_name:  Key from PERSONAS dict
        ttl_seconds:   Token lifetime (default 1 hour)
    Returns:
        Signed JWT string
    """
    try:
        import jwt
    except ImportError:
        raise RuntimeError("PyJWT not installed — pip install pyjwt")

    claims = dict(PERSONAS[persona_name])
    now = int(time.time())
    claims.update({
        "iat": now,
        "exp": now + ttl_seconds,
        "iss": "rm-prep-test",
    })
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_expired_token(persona_name: str = "alice_rm") -> str:
    """Generate an already-expired JWT for testing 401 handling."""
    try:
        import jwt
    except ImportError:
        raise RuntimeError("PyJWT not installed")

    claims = dict(PERSONAS[persona_name])
    now = int(time.time())
    claims.update({"iat": now - 7200, "exp": now - 3600, "iss": "rm-prep-test"})
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_tampered_token(persona_name: str = "alice_rm") -> str:
    """
    Generate a token signed with the wrong secret — for testing 401 on
    signature verification failure.
    """
    try:
        import jwt
    except ImportError:
        raise RuntimeError("PyJWT not installed")

    claims = dict(PERSONAS[persona_name])
    now = int(time.time())
    claims.update({"iat": now, "exp": now + 3600, "iss": "rm-prep-test"})
    return jwt.encode(claims, "WRONG-SECRET", algorithm=JWT_ALGORITHM)


# ─── CLI usage ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"\nTest JWT Tokens  (secret: {JWT_SECRET!r})\n{'='*60}")
    for name in PERSONAS:
        token = get_token(name)
        print(f"\n{name}:")
        print(f"  role:    {PERSONAS[name]['role']}")
        print(f"  accounts:{len(PERSONAS[name]['assigned_account_ids'])} assigned")
        print(f"  clearance:{PERSONAS[name]['compliance_clearance']}")
        print(f"  token:   {token[:80]}...")

    print("\n\nExpired token (for 401 test):")
    print(get_expired_token()[:80] + "...")

    print("\nTampered token (wrong signature):")
    print(get_tampered_token()[:80] + "...")
