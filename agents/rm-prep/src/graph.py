"""
RM Prep Orchestrator — LangGraph StateGraph.

Pipeline:
  parse_intent → route → gather_crm
                              ├─(parallel)─ gather_payments ─┐
                              └─(parallel)─ gather_news      ─┤
                                                              └─ synthesize → format_brief

Model tiering:
  parse_intent:    fast-routing  (Haiku — structured extraction)
  route:           no LLM        (pure Python dict lookup)
  gather_crm:      fast-routing  (Haiku — tool call + JSON passthrough)
  gather_payments: fast-routing  (Haiku — tool call + JSON passthrough)
  gather_news:     fast-routing  (Haiku — tool call + JSON passthrough)
  synthesize:      complex-routing (Sonnet — coherent brief writing)
  format_brief:    no LLM        (Jinja2 template render)
"""
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from pydantic import BaseModel

from platform_sdk import AgentConfig, build_specialist_agent, configure_logging, get_logger
from .brief import RMBrief, render_brief
from .state import RMPrepState

configure_logging()
log = get_logger(__name__)

_PROMPT_DIR = Path(__file__).parent / "prompts"
_jinja_env = Environment(loader=FileSystemLoader(str(_PROMPT_DIR)), autoescape=False)


def _load_prompt(template: str, **ctx) -> str:
    return _jinja_env.get_template(template).render(**ctx)


def _make_llm(model_route: str, base_url: str, api_key: str) -> ChatOpenAI:
    return ChatOpenAI(
        model=model_route,
        api_key=api_key,
        base_url=base_url,
        temperature=0,
        max_retries=2,
    )


# ─── Node factories (closures capture agent/llm dependencies) ─────────────────

class _IntentResult(BaseModel):
    client_name: str
    intent_type: str
    meeting_date: Optional[str] = None


def _make_parse_intent_node(router_llm: ChatOpenAI):
    structured = router_llm.with_structured_output(_IntentResult)

    async def parse_intent(state: RMPrepState) -> dict:
        system = SystemMessage(content="""Extract from the RM's message:
- client_name: exact company name mentioned
- intent_type: one of full_brief | quick_update | news_check | payment_check | follow_up
  (full_brief = preparing for a meeting; quick_update = what's new;
   news_check = only news; payment_check = only payments; follow_up = follow-up question)
- meeting_date: date if explicitly mentioned, else null""")
        try:
            result = await structured.ainvoke([system] + list(state["messages"]))
            log.info("intent_parsed", client=result.client_name, intent=result.intent_type)
            return {
                "client_name": result.client_name,
                "intent_type": result.intent_type,
                "meeting_date": result.meeting_date,
                "error_states": {},
            }
        except Exception as exc:
            log.error("parse_intent_error", error=str(exc))
            # Fallback: treat as full_brief for the last message
            last_msg = state["messages"][-1].content if state["messages"] else ""
            return {
                "client_name": last_msg[:100],
                "intent_type": "full_brief",
                "error_states": {"parse_intent": str(exc)},
            }
    return parse_intent


def _make_route_node():
    _ROUTING_MAP = {
        "full_brief":    ["crm", "payments", "news"],
        "quick_update":  ["crm", "payments", "news"],
        "news_check":    ["news"],
        "payment_check": ["payments"],
        "follow_up":     ["crm"],
    }

    async def route(state: RMPrepState) -> dict:
        agents = _ROUTING_MAP.get(state.get("intent_type", "full_brief"), ["crm", "payments", "news"])
        log.info("routing_decision", intent=state.get("intent_type"), agents=agents)
        return {"agents_to_invoke": agents}
    return route


def _make_gather_crm_node(crm_agent):
    async def gather_crm(state: RMPrepState) -> dict:
        if "crm" not in state.get("agents_to_invoke", []):
            return {"crm_output": None}
        client = state.get("client_name", "")
        try:
            result = await crm_agent.ainvoke({
                "messages": [HumanMessage(content=f"Client to look up: {client}")]
            })
            output = result["messages"][-1].content
            # Extract account_id for the payments node
            account_id = None
            try:
                data = json.loads(output)
                account_id = data.get("account_id")
            except (json.JSONDecodeError, AttributeError):
                pass
            log.info("crm_gathered", client=client, account_id=account_id)
            return {"crm_output": output, "account_id": account_id}
        except Exception as exc:
            log.error("crm_gather_error", client=client, error=str(exc))
            return {
                "crm_output": json.dumps({"error": "crm_unavailable", "detail": str(exc)}),
                "error_states": {"crm": str(exc)},
            }
    return gather_crm


def _make_gather_payments_node(pay_agent):
    async def gather_payments(state: RMPrepState) -> dict:
        if "payments" not in state.get("agents_to_invoke", []):
            return {"payments_output": None}
        # Payments tool uses client_name (= Account.Name = dim_party.PartyName)
        # as the join key across CRM and bankdw schemas.
        client_name = state.get("client_name", "")
        try:
            result = await pay_agent.ainvoke({
                "messages": [HumanMessage(content=f"client_name={client_name}")]
            })
            output = result["messages"][-1].content
            log.info("payments_gathered", client=client_name)
            return {"payments_output": output}
        except Exception as exc:
            log.error("payments_gather_error", client=client_name, error=str(exc))
            return {
                "payments_output": json.dumps({"error": "payments_unavailable", "client_name": client_name, "detail": str(exc)}),
                "error_states": {"payments": str(exc)},
            }
    return gather_payments


def _make_gather_news_node(news_agent):
    async def gather_news(state: RMPrepState) -> dict:
        if "news" not in state.get("agents_to_invoke", []):
            return {"news_output": None}
        company = state.get("client_name", "")
        try:
            result = await news_agent.ainvoke({
                "messages": [HumanMessage(content=f"company_name={company}")]
            })
            output = result["messages"][-1].content
            log.info("news_gathered", company=company)
            return {"news_output": output}
        except Exception as exc:
            log.error("news_gather_error", company=company, error=str(exc))
            return {
                "news_output": json.dumps({"error": "news_unavailable", "detail": str(exc)}),
                "error_states": {"news": str(exc)},
            }
    return gather_news


def _make_synthesize_node(synthesis_llm: ChatOpenAI, synthesis_template: str):
    structured = synthesis_llm.with_structured_output(RMBrief)

    async def synthesize(state: RMPrepState) -> dict:
        prompt = _load_prompt(
            synthesis_template,
            today=datetime.now().strftime("%B %d, %Y"),
            rm_name=state.get("rm_id", "Relationship Manager"),
            crm_data=state.get("crm_output") or "[CRM data unavailable]",
            payments_data=state.get("payments_output") or "[Payments data unavailable]",
            news_data=state.get("news_output") or "[News search unavailable]",
        )
        try:
            brief = await structured.ainvoke([HumanMessage(content=prompt)])
            log.info("brief_synthesized", client=state.get("client_name"))
            return {"brief_data": brief.model_dump()}
        except Exception as exc:
            log.error("synthesis_error", error=str(exc))
            # Fallback: return a minimal brief with the raw data
            fallback = RMBrief(
                client_name=state.get("client_name", "Unknown"),
                meeting_date=state.get("meeting_date"),
                executive_summary=f"Brief generation encountered an error: {exc}. Raw data is available in the source fields.",
                recent_activity=state.get("crm_output") or "[Unavailable]",
                payment_activity=state.get("payments_output") or "[Unavailable]",
                latest_news=state.get("news_output") or "[Unavailable]",
                talking_points=["Review the raw data above with your team"],
                suggested_questions=["What are your current priorities?"],
                watch_items="Brief generation failed — review raw data",
                sources=["[CRM]", "[Payments]", "[News]"],
            )
            return {"brief_data": fallback.model_dump(), "error_states": {"synthesis": str(exc)}}
    return synthesize


def _make_format_brief_node():
    async def format_brief(state: RMPrepState) -> dict:
        brief_data = state.get("brief_data")
        if not brief_data:
            return {"brief_markdown": "Brief generation failed. Please try again."}
        brief = RMBrief(**brief_data)
        markdown = render_brief(brief, prepared_by=state.get("rm_id", "RM Prep Agent"))
        return {"brief_markdown": markdown}
    return format_brief


# ─── Orchestrator builder ──────────────────────────────────────────────────────

def build_rm_orchestrator(
    crm_agent,
    pay_agent,
    news_agent,
    synthesis_llm: ChatOpenAI,
    config: AgentConfig,
):
    """Build the RM Prep StateGraph orchestrator."""
    base_url = os.environ.get("LITELLM_BASE_URL", "http://litellm:4000/v1")
    api_key = os.environ.get("INTERNAL_API_KEY", "")
    router_llm = _make_llm(config.router_model_route, base_url, api_key)

    builder = StateGraph(RMPrepState)

    builder.add_node("parse_intent",     _make_parse_intent_node(router_llm))
    builder.add_node("route",            _make_route_node())
    builder.add_node("gather_crm",       _make_gather_crm_node(crm_agent))
    builder.add_node("gather_payments",  _make_gather_payments_node(pay_agent))
    builder.add_node("gather_news",      _make_gather_news_node(news_agent))
    builder.add_node("synthesize",       _make_synthesize_node(synthesis_llm, "rm_prep_synthesis.j2"))
    builder.add_node("format_brief",     _make_format_brief_node())

    # Sequential edges
    builder.set_entry_point("parse_intent")
    builder.add_edge("parse_intent", "route")
    builder.add_edge("route", "gather_crm")

    # Parallel fan-out after CRM (payments needs account_id from CRM)
    builder.add_edge("gather_crm", "gather_payments")
    builder.add_edge("gather_crm", "gather_news")

    # Converge at synthesize (waits for both parallel branches)
    builder.add_edge("gather_payments", "synthesize")
    builder.add_edge("gather_news", "synthesize")

    builder.add_edge("synthesize", "format_brief")
    builder.add_edge("format_brief", END)

    checkpointer = MemorySaver()  # swap for PostgresSaver in prod
    return builder.compile(checkpointer=checkpointer)


# ─── Lifespan context manager ─────────────────────────────────────────────────

@asynccontextmanager
async def orchestrator_lifespan(app):
    """Connect to all 3 MCP servers, build specialist agents and orchestrator."""
    from .mcp_bridge import MCPToolBridge  # copied from agents/src/ in Dockerfile

    config = AgentConfig.from_env()
    base_url = os.environ.get("LITELLM_BASE_URL", "http://litellm:4000/v1")
    api_key = os.environ.get("INTERNAL_API_KEY", "")

    sf_url  = os.environ.get("SALESFORCE_MCP_URL",  "http://salesforce-mcp:8081/sse")
    pay_url = os.environ.get("PAYMENTS_MCP_URL",    "http://payments-mcp:8082/sse")
    news_url = os.environ.get("NEWS_MCP_URL",       "http://news-search-mcp:8083/sse")

    bridges = {
        "salesforce": MCPToolBridge(sf_url),
        "payments":   MCPToolBridge(pay_url),
        "news":       MCPToolBridge(news_url),
    }

    for name, bridge in bridges.items():
        await bridge.connect()
        log.info("mcp_connected", server=name)

    sf_tools   = await bridges["salesforce"].get_langchain_tools()
    pay_tools  = await bridges["payments"].get_langchain_tools()
    news_tools = await bridges["news"].get_langchain_tools()

    crm_prompt  = _load_prompt("crm_specialist.j2",  client_name="{{ client_name }}")
    pay_prompt  = _load_prompt("pay_specialist.j2",  client_name="{{ client_name }}")
    news_prompt = _load_prompt("news_specialist.j2", company_name="{{ company_name }}")

    crm_agent  = build_specialist_agent(sf_tools,   config, crm_prompt,  model_override=config.specialist_model_route)
    pay_agent  = build_specialist_agent(pay_tools,  config, pay_prompt,  model_override=config.specialist_model_route)
    news_agent = build_specialist_agent(news_tools, config, news_prompt, model_override=config.specialist_model_route)

    synthesis_llm = _make_llm(config.synthesis_model_route, base_url, api_key)

    app.state.orchestrator = build_rm_orchestrator(
        crm_agent, pay_agent, news_agent, synthesis_llm, config
    )
    app.state.config = config
    log.info("rm_prep_orchestrator_ready")

    yield

    for name, bridge in bridges.items():
        await bridge.disconnect()
        log.info("mcp_disconnected", server=name)
