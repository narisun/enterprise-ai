"""
Integration tests — rm-prep-agent HTTP server.

Tests health, auth endpoints, and persona token issuance.
The /brief/persona end-to-end brief tests (which need the full LLM stack)
live in tests/evals/.

Requires: rm-prep-agent container running (docker-compose.test.yml).
"""
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1: Health
# ─────────────────────────────────────────────────────────────────────────────

class TestHealth:
    async def test_health_returns_200(self, rm_prep_client):
        resp = await rm_prep_client.get("/health")
        assert resp.status_code == 200

    async def test_health_body(self, rm_prep_client):
        resp = await rm_prep_client.get("/health")
        body = resp.json()
        assert body["status"] == "ok"
        assert "rm-prep" in body.get("service", "")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2: /auth/personas — persona listing
# ─────────────────────────────────────────────────────────────────────────────

class TestPersonaListing:
    async def test_personas_returns_200(self, rm_prep_client):
        resp = await rm_prep_client.get("/auth/personas")
        assert resp.status_code == 200

    async def test_personas_returns_list(self, rm_prep_client):
        personas = (await rm_prep_client.get("/auth/personas")).json()
        assert isinstance(personas, list)
        assert len(personas) >= 4

    async def test_personas_contain_expected_names(self, rm_prep_client):
        personas = (await rm_prep_client.get("/auth/personas")).json()
        names = {p["name"] for p in personas}
        assert {"manager", "senior_rm", "rm", "readonly"}.issubset(names)

    async def test_manager_has_full_clearance(self, rm_prep_client):
        personas = (await rm_prep_client.get("/auth/personas")).json()
        manager = next(p for p in personas if p["name"] == "manager")
        assert "compliance_full" in manager["compliance_clearance"]

    async def test_rm_has_two_accounts(self, rm_prep_client):
        personas = (await rm_prep_client.get("/auth/personas")).json()
        rm = next(p for p in personas if p["name"] == "rm")
        assert rm["assigned_account_count"] == 2

    async def test_readonly_has_zero_accounts(self, rm_prep_client):
        personas = (await rm_prep_client.get("/auth/personas")).json()
        readonly = next(p for p in personas if p["name"] == "readonly")
        assert readonly["assigned_account_count"] == 0

    async def test_personas_blocked_without_api_key(self, rm_prep_url):
        import httpx
        async with httpx.AsyncClient(base_url=rm_prep_url, timeout=10.0) as anon:
            resp = await anon.get("/auth/personas")
        assert resp.status_code in (401, 403)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3: /auth/token — JWT issuance
# ─────────────────────────────────────────────────────────────────────────────

class TestTokenIssuance:
    async def test_manager_token_issued(self, rm_prep_client):
        resp = await rm_prep_client.post("/auth/token", json={"persona": "manager"})
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert body["role"] == "manager"

    async def test_senior_rm_token_issued(self, rm_prep_client):
        resp = await rm_prep_client.post("/auth/token", json={"persona": "senior_rm"})
        assert resp.status_code == 200
        assert resp.json()["role"] == "senior_rm"

    async def test_rm_token_issued(self, rm_prep_client):
        resp = await rm_prep_client.post("/auth/token", json={"persona": "rm"})
        assert resp.status_code == 200
        assert resp.json()["role"] == "rm"

    async def test_readonly_token_issued(self, rm_prep_client):
        resp = await rm_prep_client.post("/auth/token", json={"persona": "readonly"})
        assert resp.status_code == 200
        assert resp.json()["role"] == "readonly"

    async def test_unknown_persona_returns_400(self, rm_prep_client):
        resp = await rm_prep_client.post("/auth/token", json={"persona": "god_mode"})
        assert resp.status_code == 400

    async def test_token_is_valid_jwt(self, rm_prep_client, jwt_secret):
        import jwt as pyjwt
        resp = await rm_prep_client.post("/auth/token", json={"persona": "manager"})
        token = resp.json()["access_token"]
        payload = pyjwt.decode(token, jwt_secret, algorithms=["HS256"])
        assert payload["role"] == "manager"
        assert "compliance_full" in payload["compliance_clearance"]

    async def test_rm_token_contains_assigned_accounts(self, rm_prep_client, jwt_secret):
        import jwt as pyjwt
        resp = await rm_prep_client.post("/auth/token", json={"persona": "rm"})
        token = resp.json()["access_token"]
        payload = pyjwt.decode(token, jwt_secret, algorithms=["HS256"])
        assert len(payload["assigned_account_ids"]) == 2

    async def test_custom_expiry_respected(self, rm_prep_client, jwt_secret):
        import jwt as pyjwt
        resp = await rm_prep_client.post(
            "/auth/token", json={"persona": "manager", "expires_in": 120}
        )
        token = resp.json()["access_token"]
        payload = pyjwt.decode(token, jwt_secret, algorithms=["HS256"])
        lifetime = payload["exp"] - payload["iat"]
        assert abs(lifetime - 120) <= 5  # allow ±5s for clock drift

    async def test_token_blocked_without_api_key(self, rm_prep_url):
        import httpx
        async with httpx.AsyncClient(base_url=rm_prep_url, timeout=10.0) as anon:
            resp = await anon.post("/auth/token", json={"persona": "manager"})
        assert resp.status_code in (401, 403)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4: /brief — request validation (no LLM call needed)
# ─────────────────────────────────────────────────────────────────────────────

class TestBriefRequestValidation:
    async def test_empty_prompt_rejected(self, rm_prep_client):
        resp = await rm_prep_client.post(
            "/brief/sync",
            json={"prompt": "hi", "rm_id": "test", "session_id": "test-session"},
        )
        # FastAPI validates min_length=5 — "hi" is too short
        assert resp.status_code == 422

    async def test_missing_api_key_rejected(self, rm_prep_url):
        import httpx
        async with httpx.AsyncClient(base_url=rm_prep_url, timeout=10.0) as anon:
            resp = await anon.post(
                "/brief/sync",
                json={"prompt": "Prepare me for a meeting", "rm_id": "x", "session_id": "x"},
            )
        assert resp.status_code in (401, 403)
