"""
Unit tests for the agent graph builder.

Tests verify:
- Agent builds successfully with tools
- System prompt is rendered from the template
- Missing INTERNAL_API_KEY raises a clear error
"""
import os
import pytest
from unittest.mock import MagicMock, patch


@pytest.fixture(autouse=True)
def env_vars(monkeypatch):
    """Provide all required environment variables for every test."""
    monkeypatch.setenv("LITELLM_BASE_URL", "http://localhost:4000/v1")
    monkeypatch.setenv("INTERNAL_API_KEY", "sk-test-key-for-unit-tests")
    monkeypatch.setenv("AGENT_MODEL_ROUTE", "complex-routing")


def _make_mock_tool(name: str) -> MagicMock:
    tool = MagicMock()
    tool.name = name
    return tool


class TestBuildEnterpriseAgent:
    def test_builds_successfully_with_tools(self):
        """Agent graph is constructed without errors when tools are provided."""
        tools = [_make_mock_tool("execute_read_query"), _make_mock_tool("search_documents")]
        # Patch both ChatOpenAI and create_react_agent — this is a unit test for
        # build_enterprise_agent's logic, not for LangGraph's tool validation.
        with patch("src.graph.ChatOpenAI"), patch("src.graph.create_react_agent") as mock_agent:
            mock_agent.return_value = MagicMock()
            from src.graph import build_enterprise_agent
            agent = build_enterprise_agent(tools)
        assert agent is not None

    def test_builds_successfully_with_no_tools(self):
        """Agent graph handles an empty tool list gracefully."""
        with patch("src.graph.ChatOpenAI"), patch("src.graph.create_react_agent") as mock_agent:
            mock_agent.return_value = MagicMock()
            from src.graph import build_enterprise_agent
            agent = build_enterprise_agent([])
        assert agent is not None

    def test_raises_on_missing_api_key(self, monkeypatch):
        """Clear error is raised when INTERNAL_API_KEY is not set."""
        monkeypatch.delenv("INTERNAL_API_KEY", raising=False)
        with pytest.raises(ValueError, match="INTERNAL_API_KEY"):
            from src.graph import build_enterprise_agent
            # Must re-import after env change since module may be cached
            import importlib
            import src.graph as graph_module
            importlib.reload(graph_module)
            graph_module.build_enterprise_agent([])


class TestLoadSystemPrompt:
    def test_renders_tool_names(self):
        """Tool names are injected into the prompt template."""
        from src.graph import load_system_prompt
        rendered = load_system_prompt(
            "enterprise_agent.j2",
            tool_names=["execute_read_query", "search_documents"],
        )
        assert "execute_read_query" in rendered
        assert "search_documents" in rendered

    def test_renders_without_optional_context(self):
        """Template renders even when optional context vars are omitted."""
        from src.graph import load_system_prompt
        rendered = load_system_prompt("enterprise_agent.j2")
        assert len(rendered) > 0
