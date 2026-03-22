"""
Integration test conftest — provides real DB pool, HTTP clients, and JWT helpers.

Services expected (from docker-compose.test.yml):
  pgvector    → DB_HOST:DB_PORT  (default: localhost:5432)
  opa         → OPA_URL          (default: http://localhost:8181)
  payments-mcp→ PAYMENTS_MCP_URL (default: http://localhost:8082)
  rm-prep     → RM_PREP_URL      (default: http://localhost:8003)

Environment variables (match .env.example):
  DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
  OPA_URL, RM_PREP_URL, PAYMENTS_MCP_URL
  INTERNAL_API_KEY, JWT_SECRET
"""
import os
import time

import asyncpg
import httpx
import pytest
import pytest_asyncio


# ── Connection parameters ──────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def db_dsn() -> dict:
    return {
        "host":     os.environ.get("DB_HOST", "localhost"),
        "port":     int(os.environ.get("DB_PORT", 5432)),
        "user":     os.environ.get("DB_USER", "admin"),
        "password": os.environ.get("DB_PASS", os.environ.get("POSTGRES_PASSWORD", "")),
        "database": os.environ.get("DB_NAME", "ai_memory"),
    }


@pytest.fixture(scope="session")
def opa_url() -> str:
    return os.environ.get("OPA_URL", "http://localhost:8181")


@pytest.fixture(scope="session")
def rm_prep_url() -> str:
    return os.environ.get("RM_PREP_URL", "http://localhost:8003")


@pytest.fixture(scope="session")
def api_key() -> str:
    return os.environ.get("INTERNAL_API_KEY", "test-key")


@pytest.fixture(scope="session")
def jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "test-secret-change-in-prod")


# ── Database pool (session-scoped — one pool for the entire test run) ──────────

@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def db_pool(db_dsn):
    pool = await asyncpg.create_pool(**db_dsn, min_size=1, max_size=5)
    yield pool
    await pool.close()


# ── HTTP clients ───────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def opa_client(opa_url):
    async with httpx.AsyncClient(base_url=opa_url, timeout=10.0) as client:
        yield client


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def rm_prep_client(rm_prep_url, api_key):
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(base_url=rm_prep_url, headers=headers, timeout=120.0) as client:
        yield client


# ── JWT factory ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def make_jwt(jwt_secret):
    """Return a callable: make_jwt(persona_dict) → signed JWT string."""
    def _make(persona: dict) -> str:
        import jwt as pyjwt
        now = int(time.time())
        payload = {**persona, "iat": now, "exp": now + 3600}
        return pyjwt.encode(payload, jwt_secret, algorithm="HS256")
    return _make


# ── Canned persona payloads — derived from platform_sdk.testing ────────────────
# Single source of truth: platform_sdk.testing.TEST_PERSONAS

from platform_sdk.testing import TEST_PERSONAS

MICROSOFT_ID = "001000000000001AAA"
FORD_ID       = "001000000000002AAA"


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


# ── Transaction isolation ──────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="function")
async def db_transaction(db_pool):
    """
    Function-scoped fixture that wraps each test in a database transaction.

    The transaction is ROLLED BACK after each test, ensuring test isolation:
    no test can leave behind data that affects subsequent tests.

    Usage:
        async def test_something(db_transaction):
            await db_transaction.execute("INSERT INTO ...")
            # Transaction is rolled back after test completes
    """
    conn = await db_pool.acquire()
    tr = conn.transaction()
    await tr.start()
    try:
        yield conn
    finally:
        await tr.rollback()
        await db_pool.release(conn)
