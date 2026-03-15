"""
Agent graph builder — constructs the LangGraph ReAct agent.

System prompts are loaded from versioned Jinja2 templates, never
hardcoded. This allows prompt A/B testing and evaluation without
requiring a code change or redeployment.
"""
import os
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent  # noqa: PLC0415 — deprecated in LG 1.0 but API-compatible

# Prompt registry: versioned Jinja2 templates in src/prompts/
_PROMPT_DIR = Path(__file__).parent / "prompts"
_jinja_env = Environment(loader=FileSystemLoader(str(_PROMPT_DIR)), autoescape=False)


def load_system_prompt(template_name: str, **context) -> str:
    """
    Render a Jinja2 prompt template.

    Args:
        template_name: Filename inside src/prompts/ (e.g. "enterprise_agent.j2")
        **context:     Variables passed into the template (e.g. tool_names, organization)

    Returns:
        Rendered prompt string.
    """
    template = _jinja_env.get_template(template_name)
    return template.render(**context)


def build_enterprise_agent(tools: list):
    """
    Construct a LangGraph ReAct agent backed by the LiteLLM proxy.

    Configuration comes entirely from environment variables — no
    hardcoded keys or URLs.

    Args:
        tools: List of LangChain StructuredTool objects from MCPToolBridge.

    Returns:
        A compiled LangGraph CompiledGraph ready for ainvoke / astream.
    """
    base_url = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000/v1")
    api_key = os.environ.get("INTERNAL_API_KEY")
    model_route = os.environ.get("AGENT_MODEL_ROUTE", "complex-routing")

    if not api_key:
        raise ValueError("INTERNAL_API_KEY must be set — see .env.example")

    llm = ChatOpenAI(
        model=model_route,
        api_key=api_key,
        base_url=base_url,
        temperature=0,          # Deterministic for enterprise use
        max_retries=2,          # LiteLLM handles provider failover
    )

    tool_names = [t.name for t in tools]
    system_prompt = load_system_prompt("enterprise_agent.j2", tool_names=tool_names)

    agent_executor = create_react_agent(llm, tools, prompt=system_prompt)
    return agent_executor
