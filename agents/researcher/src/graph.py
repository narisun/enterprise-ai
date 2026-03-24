"""
Research deep agent graph builder.

Uses LangChain's create_deep_agent to build a planning/execution agent
with web search tools, filesystem backend, and subagent delegation.
"""

from __future__ import annotations

import logging
from typing import Optional

from langchain_openai import ChatOpenAI

from .config import ResearcherConfig
from .tools.web_search import web_search, web_search_news

logger = logging.getLogger(__name__)

# System prompt for the research agent
RESEARCHER_SYSTEM_PROMPT = """\
You are an Enterprise Research Agent — a thorough, methodical analyst that helps
financial services professionals research companies, markets, industries, and
competitive landscapes.

## Your workflow

1. **Plan first**: Always start by creating a research plan using write_todos.
   Break the user's question into concrete research steps (3-7 steps).

2. **Execute systematically**: Work through your plan step by step.
   - Use web_search to find factual information, data, and analysis.
   - Use web_search_news to find recent news and developments.
   - Use write_file to save intermediate findings — never try to hold
     everything in memory.
   - For complex subtasks, delegate to a subagent using the task tool.

3. **Synthesize**: After gathering all data, synthesize your findings into
   a clear, well-structured analysis. Cite your sources.

4. **Review**: Before delivering, review your output for accuracy,
   completeness, and clarity. If something is uncertain, say so.

## Output quality

- Write in professional, concise prose (not bullet-point dumps).
- Cite specific data points and sources.
- Distinguish between facts and your analysis.
- Flag any information that may be outdated or uncertain.
- For financial data, note the date/period of the figures.

## Important

- You are a research assistant, not a financial advisor. Never give
  investment recommendations.
- If you cannot find reliable information on a topic, say so rather
  than speculating.
- Keep your workspace organized — use descriptive filenames when
  saving research notes.
"""


def build_research_agent(config: ResearcherConfig, checkpointer=None):
    """Build the research deep agent graph.

    Args:
        config: Researcher configuration.
        checkpointer: Optional LangGraph checkpointer for persistence.

    Returns:
        A compiled LangGraph graph ready for streaming/invocation.
    """
    try:
        from deepagents import create_deep_agent
    except ImportError:
        logger.warning(
            "deepagents package not installed — falling back to simple ReAct agent"
        )
        return _build_fallback_agent(config, checkpointer)

    llm = ChatOpenAI(
        model=config.model,
        temperature=config.temperature,
        api_key=config.openai_api_key or None,
    )

    # Custom tools that supplement deep agents' built-in tools
    custom_tools = [web_search, web_search_news]

    graph = create_deep_agent(
        model=llm,
        tools=custom_tools,
        system_prompt=RESEARCHER_SYSTEM_PROMPT,
        checkpointer=checkpointer,
    )

    logger.info("Research deep agent built successfully (model=%s)", config.model)
    return graph


def _build_fallback_agent(config: ResearcherConfig, checkpointer=None):
    """Fallback: build a simple LangGraph ReAct agent if deepagents is unavailable.

    This lets us develop and test the SSE streaming pipeline even without
    the deepagents package installed.
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
    from typing import Annotated, TypedDict, Sequence

    # LangGraph 0.x vs 1.x compatibility
    try:
        from langgraph.graph import StateGraph, END
        from langgraph.graph.message import add_messages
    except ImportError:
        from langgraph.graph import StateGraph
        from langgraph.graph import END
        from langgraph.graph.message import add_messages

    logger.info("Building fallback ReAct agent (deepagents not available)")

    class AgentState(TypedDict):
        messages: Annotated[Sequence, add_messages]
        plan: dict | None
        session_id: str

    llm = ChatOpenAI(
        model=config.model,
        temperature=config.temperature,
        api_key=config.openai_api_key or None,
    )

    tools = [web_search, web_search_news]
    llm_with_tools = llm.bind_tools(tools)

    tool_map = {t.name: t for t in tools}

    async def plan_node(state: AgentState) -> dict:
        """Generate a research plan."""
        msgs = state["messages"]
        last_user = next(
            (m for m in reversed(msgs) if isinstance(m, HumanMessage)),
            None,
        )
        if not last_user:
            return {}

        plan_prompt = [
            SystemMessage(content=(
                "You are a research planner. Given the user's question, create a "
                "research plan as a JSON object with a 'todos' array. Each todo has "
                "'text' (description) and 'status' ('pending'). Keep it to 3-5 steps. "
                "Respond ONLY with the JSON, no other text."
            )),
            last_user,
        ]
        resp = await llm.ainvoke(plan_prompt)
        try:
            import json
            plan = json.loads(resp.content)
            return {"plan": plan}
        except Exception:
            return {"plan": {"todos": [
                {"text": "Research the topic", "status": "pending"},
                {"text": "Analyze findings", "status": "pending"},
                {"text": "Synthesize report", "status": "pending"},
            ]}}

    async def research_node(state: AgentState) -> dict:
        """Execute research using tools."""
        msgs = [SystemMessage(content=RESEARCHER_SYSTEM_PROMPT)] + list(state["messages"])
        resp = await llm_with_tools.ainvoke(msgs)

        if resp.tool_calls:
            from langchain_core.messages import ToolMessage
            tool_results = []
            for tc in resp.tool_calls:
                tool_fn = tool_map.get(tc["name"])
                if tool_fn:
                    result = await tool_fn.ainvoke(tc["args"])
                    tool_results.append(
                        ToolMessage(content=str(result), tool_call_id=tc["id"])
                    )
            return {"messages": [resp] + tool_results}

        return {"messages": [resp]}

    async def synthesize_node(state: AgentState) -> dict:
        """Produce final synthesis."""
        msgs = [SystemMessage(content=RESEARCHER_SYSTEM_PROMPT)] + list(state["messages"])
        msgs.append(HumanMessage(content=(
            "Now synthesize all the information gathered above into a comprehensive, "
            "well-structured research report. Use markdown formatting. Cite sources."
        )))
        resp = await llm.ainvoke(msgs)
        return {"messages": [resp]}

    def should_continue(state: AgentState) -> str:
        msgs = state["messages"]
        last = msgs[-1] if msgs else None
        if last and hasattr(last, "tool_calls") and last.tool_calls:
            return "research"
        return "synthesize"

    builder = StateGraph(AgentState)
    builder.add_node("plan", plan_node)
    builder.add_node("research", research_node)
    builder.add_node("synthesize", synthesize_node)

    builder.set_entry_point("plan")
    builder.add_edge("plan", "research")
    builder.add_conditional_edges("research", should_continue, {
        "research": "research",
        "synthesize": "synthesize",
    })
    builder.add_edge("synthesize", END)

    return builder.compile(checkpointer=checkpointer)
