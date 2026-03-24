"""
Agent graph builder — constructs the LangGraph ReAct agent.

System prompts are loaded from versioned Jinja2 templates, never
hardcoded. This allows prompt A/B testing and evaluation without
requiring a code change or redeployment.

The heavy lifting (LLM construction, compaction wiring, LangGraph
create_react_agent call) is now delegated to platform_sdk.build_agent
so this module stays focused on prompt loading.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from platform_sdk import AgentConfig, build_agent

# Prompt registry: versioned Jinja2 templates in src/prompts/
_PROMPT_DIR = Path(__file__).parent / "prompts"
# autoescape=False is correct for LLM prompt templates (not HTML).
# IMPORTANT: never pass raw user input as a Jinja2 template variable — doing so
# would allow prompt injection via {{ }} / {% %} constructs.  If user-supplied
# content must appear in the prompt, inject it as a data value (e.g. a quoted
# string inside the template body), never as a template context variable itself.
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

    Delegates to platform_sdk.build_agent which wires in:
    - Model routing via AgentConfig.model_route (AGENT_MODEL_ROUTE env var)
    - Context compaction via AgentConfig.enable_compaction / context_token_limit
    - System prompt injection

    Configuration comes entirely from environment variables — no
    hardcoded keys or URLs.

    Args:
        tools: List of LangChain StructuredTool objects from MCPToolBridge.

    Returns:
        A compiled LangGraph CompiledGraph ready for ainvoke / astream.
    """
    config = AgentConfig.from_env()

    tool_names = [t.name for t in tools]
    system_prompt = load_system_prompt("enterprise_agent.j2", tool_names=tool_names)

    return build_agent(tools, config=config, prompt=system_prompt)
