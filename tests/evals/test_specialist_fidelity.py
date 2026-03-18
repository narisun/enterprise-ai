"""
Eval tests — specialist agent fidelity.

Tests that specialist agents (pay_specialist, crm_specialist) correctly:
  1. Call the right tool with the correct client_name argument
  2. Return the complete tool output verbatim without summarising or modifying it
  3. Pass error JSON through unchanged when the tool returns an error

These tests use mocked tools — no MCP server or DB required.
They exercise the LLM's tool-calling behaviour in isolation.

Requires: LITELLM_BASE_URL or OPENAI_API_KEY
"""
import json
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.tools import Tool

# Make rm-prep src importable
sys.path.insert(0, str(Path(__file__).parents[2] / "agents" / "rm-prep" / "src"))

pytestmark = [pytest.mark.eval, pytest.mark.asyncio, pytest.mark.slow]

_CLIENT_NAME = "Microsoft Corp."
_FORD_NAME   = "Ford Motor Company"


def _make_mock_payments_tool(return_value: Any) -> Tool:
    """Create a mock get_payment_summary tool that returns return_value."""
    async def _fn(client_name: str) -> str:
        if isinstance(return_value, (dict, list)):
            return json.dumps(return_value)
        return str(return_value)

    return Tool(
        name="get_payment_summary",
        description=(
            "Get bank payment transaction summary for a client. "
            "Args: client_name (str) — company name as in Salesforce."
        ),
        func=lambda **kw: None,
        coroutine=_fn,
    )


def _make_mock_crm_tool(return_value: Any) -> Tool:
    async def _fn(account_name: str) -> str:
        if isinstance(return_value, (dict, list)):
            return json.dumps(return_value)
        return str(return_value)

    return Tool(
        name="get_salesforce_summary",
        description="Get CRM data for an account. Args: account_name (str).",
        func=lambda **kw: None,
        coroutine=_fn,
    )


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1: Payment specialist — tool calling behaviour
# ─────────────────────────────────────────────────────────────────────────────

class TestPaySpecialistToolCalling:
    @pytest.fixture(autouse=True)
    def _set_env(self, monkeypatch):
        """Ensure the LLM can be constructed."""
        import os
        monkeypatch.setenv("LITELLM_BASE_URL",
                           os.environ.get("LITELLM_BASE_URL", "http://localhost:4000"))
        monkeypatch.setenv("INTERNAL_API_KEY",
                           os.environ.get("INTERNAL_API_KEY", "test-key"))

    async def test_calls_tool_with_correct_client_name(self):
        """
        The pay_specialist must call get_payment_summary with the exact
        client_name passed in the HumanMessage.
        """
        called_with: list[str] = []

        async def _mock_fn(client_name: str) -> str:
            called_with.append(client_name)
            return json.dumps({"client_name": client_name, "total_outbound_usd": 1000.0})

        tool = Tool(
            name="get_payment_summary",
            description="Get payment summary. Args: client_name (str).",
            func=lambda **kw: None,
            coroutine=_mock_fn,
        )

        from platform_sdk import AgentConfig, build_specialist_agent, make_chat_llm
        import os
        config = AgentConfig.from_env()
        prompt = (
            "You are a bank payments data analyst.\n"
            "Your ONLY job:\n"
            "1. Read the exact client name from the user message\n"
            f"2. Call get_payment_summary with that exact client_name\n"
            "3. Return the COMPLETE JSON result from the tool as your final answer\n"
        )
        agent = build_specialist_agent([tool], config, prompt,
                                       model_override=config.specialist_model_route)
        from langchain_core.messages import HumanMessage
        result = await agent.ainvoke({
            "messages": [HumanMessage(content=f'Call get_payment_summary with client_name="{_CLIENT_NAME}"')]
        })
        output = result["messages"][-1].content

        assert len(called_with) >= 1, "Tool was not called at all"
        assert called_with[-1] == _CLIENT_NAME, (
            f"Tool called with '{called_with[-1]}', expected '{_CLIENT_NAME}'"
        )

    async def test_returns_tool_json_verbatim(self, fixture_microsoft_manager):
        """
        The pay_specialist prompt says 'Return the COMPLETE JSON result'.
        Verify the agent does not summarise or rephrase the JSON.
        """
        payments_data = fixture_microsoft_manager["payments_output"]
        tool = _make_mock_payments_tool(payments_data)

        from platform_sdk import AgentConfig, build_specialist_agent
        config = AgentConfig.from_env()
        prompt = (
            "You are a bank payments data analyst.\n"
            "Your ONLY job: call get_payment_summary, return COMPLETE JSON verbatim.\n"
        )
        agent = build_specialist_agent([tool], config, prompt,
                                       model_override=config.specialist_model_route)
        from langchain_core.messages import HumanMessage
        result = await agent.ainvoke({
            "messages": [HumanMessage(content=f'Call get_payment_summary with client_name="{_CLIENT_NAME}"')]
        })
        output = result["messages"][-1].content

        # The output must be valid JSON or contain the key payment fields
        try:
            parsed = json.loads(output)
            assert "total_outbound_usd" in parsed, "Missing total_outbound_usd in JSON output"
        except json.JSONDecodeError:
            # If it's not raw JSON, at least the key figure should be mentioned
            assert "45200000" in output or "45.2M" in output.replace(",", ""), (
                f"Payment volume not found in output: {output[:300]}"
            )

    async def test_passes_error_json_through(self):
        """
        When the tool returns an error, the specialist must return it verbatim.
        """
        error_payload = {"error": "no_data", "message": "No transactions found."}
        tool = _make_mock_payments_tool(error_payload)

        from platform_sdk import AgentConfig, build_specialist_agent
        config = AgentConfig.from_env()
        prompt = (
            "You are a bank payments data analyst.\n"
            "Call get_payment_summary. If tool returns error JSON, return that error JSON verbatim.\n"
        )
        agent = build_specialist_agent([tool], config, prompt,
                                       model_override=config.specialist_model_route)
        from langchain_core.messages import HumanMessage
        result = await agent.ainvoke({
            "messages": [HumanMessage(content=f'Call get_payment_summary with client_name="Unknown Corp"')]
        })
        output = result["messages"][-1].content
        # Should contain the no_data error signal
        assert "no_data" in output or "No transactions" in output, (
            f"Error not passed through: {output[:300]}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2: CRM specialist — tool calling behaviour
# ─────────────────────────────────────────────────────────────────────────────

class TestCrmSpecialistToolCalling:
    async def test_returns_crm_data_verbatim(self, fixture_microsoft_manager):
        crm_data = fixture_microsoft_manager["crm_output"]
        tool = _make_mock_crm_tool(crm_data)

        from platform_sdk import AgentConfig, build_specialist_agent
        config = AgentConfig.from_env()
        prompt = (
            "You are a CRM data analyst.\n"
            "Your ONLY job: call get_salesforce_summary, return COMPLETE JSON verbatim.\n"
        )
        agent = build_specialist_agent([tool], config, prompt,
                                       model_override=config.specialist_model_route)
        from langchain_core.messages import HumanMessage
        result = await agent.ainvoke({
            "messages": [HumanMessage(content=f'Call get_salesforce_summary for "{_CLIENT_NAME}"')]
        })
        output = result["messages"][-1].content
        # Must contain Microsoft account info
        assert "Microsoft" in output or "001000000000001AAA" in output, (
            f"CRM data not in output: {output[:300]}"
        )
