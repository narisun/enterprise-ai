"""
Integration tests — OPA policy decisions via REST API.

Tests tool_auth.rego by posting to OPA's /v1/data/mcp/tools/allow endpoint.
Every row in the authorization matrix has its own test function so failures
are immediately obvious in CI output.

Requires: OPA container running (docker-compose.test.yml).
"""

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]

_OPA_PATH = "/v1/data/mcp/tools/allow"

_AUTHORIZED_AGENT = "analytics_agent"
_UNAUTHORIZED_AGENT = "rogue_agent"
_VALID_SESSION = "550e8400-e29b-41d4-a716-446655440000"
_INVALID_SESSION = "not-a-uuid"


async def _decide(
    client, tool: str, agent_role: str, session_id: str = _VALID_SESSION, environment: str = "local"
) -> bool:
    """POST to OPA and return the allow boolean."""
    resp = await client.post(
        _OPA_PATH,
        json={
            "input": {
                "tool": tool,
                "agent_role": agent_role,
                "session_id": session_id,
                "environment": environment,
            }
        },
    )
    resp.raise_for_status()
    return resp.json()["result"]


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1: Authorized agent role is allowed for all RM tools
# ─────────────────────────────────────────────────────────────────────────────


class TestAuthorizedAgent:
    async def test_get_payment_summary_allowed(self, opa_client):
        assert await _decide(opa_client, "get_payment_summary", _AUTHORIZED_AGENT) is True

    async def test_get_salesforce_summary_allowed(self, opa_client):
        assert await _decide(opa_client, "get_salesforce_summary", _AUTHORIZED_AGENT) is True

    async def test_search_company_news_allowed(self, opa_client):
        assert await _decide(opa_client, "search_company_news", _AUTHORIZED_AGENT) is True

    async def test_all_whitelisted_agents_allowed(self, opa_client):
        for role in [
            "commercial_banking_agent",
            "data_analyst_agent",
            "compliance_agent",
            "analytics_agent",
        ]:
            result = await _decide(opa_client, "get_payment_summary", role)
            assert result is True, f"Expected allow for role={role}"


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2: Unknown / unauthorized agent role is denied
# ─────────────────────────────────────────────────────────────────────────────


class TestUnauthorizedAgent:
    async def test_rogue_agent_denied_payment(self, opa_client):
        assert await _decide(opa_client, "get_payment_summary", _UNAUTHORIZED_AGENT) is False

    async def test_rogue_agent_denied_crm(self, opa_client):
        assert await _decide(opa_client, "get_salesforce_summary", _UNAUTHORIZED_AGENT) is False

    async def test_empty_role_denied(self, opa_client):
        assert await _decide(opa_client, "get_payment_summary", "") is False

    async def test_unknown_tool_denied_even_for_authorized_agent(self, opa_client):
        assert await _decide(opa_client, "drop_all_tables", _AUTHORIZED_AGENT) is False

    async def test_nonexistent_tool_denied(self, opa_client):
        assert await _decide(opa_client, "get_bank_account_numbers", _AUTHORIZED_AGENT) is False


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3: execute_read_query requires valid session UUID
# ─────────────────────────────────────────────────────────────────────────────


class TestExecuteReadQuerySessionValidation:
    async def test_valid_session_allowed(self, opa_client):
        result = await _decide(
            opa_client, "execute_read_query", _AUTHORIZED_AGENT, session_id=_VALID_SESSION
        )
        assert result is True

    async def test_invalid_session_denied(self, opa_client):
        result = await _decide(
            opa_client, "execute_read_query", _AUTHORIZED_AGENT, session_id=_INVALID_SESSION
        )
        assert result is False

    async def test_empty_session_denied(self, opa_client):
        result = await _decide(opa_client, "execute_read_query", _AUTHORIZED_AGENT, session_id="")
        assert result is False

    async def test_sql_injection_in_session_denied(self, opa_client):
        result = await _decide(
            opa_client,
            "execute_read_query",
            _AUTHORIZED_AGENT,
            session_id="'; DROP TABLE users; --",
        )
        assert result is False


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4: Default-deny baseline
# ─────────────────────────────────────────────────────────────────────────────


class TestDefaultDeny:
    async def test_no_input_fields_denied(self, opa_client):
        resp = await opa_client.post(_OPA_PATH, json={"input": {}})
        resp.raise_for_status()
        assert resp.json()["result"] is False

    async def test_missing_tool_denied(self, opa_client):
        resp = await opa_client.post(
            _OPA_PATH,
            json={"input": {"agent_role": _AUTHORIZED_AGENT, "session_id": _VALID_SESSION}},
        )
        resp.raise_for_status()
        assert resp.json()["result"] is False
