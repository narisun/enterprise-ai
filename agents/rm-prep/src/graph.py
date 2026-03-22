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
import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from pydantic import BaseModel

from platform_sdk import AgentConfig, AgentContext, build_specialist_agent, configure_logging, get_logger, make_chat_llm
from .brief import RMBrief, render_brief
from .state import RMPrepState

configure_logging()
log = get_logger(__name__)

_PROMPT_DIR = Path(__file__).parent / "prompts"
# autoescape=False is correct for LLM prompt templates (not HTML).
# IMPORTANT: never pass raw user input as a Jinja2 template variable — doing so
# would allow prompt injection via {{ }} / {% %} constructs.  Inject user-supplied
# content as a data value inside a template body, never as a template variable itself.
_jinja_env = Environment(loader=FileSystemLoader(str(_PROMPT_DIR)), autoescape=False)


def _load_prompt(template: str, **ctx) -> str:
    return _jinja_env.get_template(template).render(**ctx)


# ─── Node factories (closures capture agent/llm dependencies) ─────────────────

class _IntentResult(BaseModel):
    client_name: str
    intent_type: str
    meeting_date: Optional[str] = None


def _make_parse_intent_node(router_llm):
    structured = router_llm.with_structured_output(_IntentResult)

    async def parse_intent(state: RMPrepState) -> dict:
        system = SystemMessage(content="""Extract from the RM's message:
- client_name: exact company name mentioned
- intent_type: one of full_brief | quick_update | news_check | payment_check | follow_up
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
            # Safe Fallback: Do not hallucinate client name. 
            # Require clarification by setting intent to follow_up or triggering an error.
            return {
                "client_name": "Clarification Required",
                "intent_type": "error_clarification_needed", # Needs to be handled by the routing logic
                "error_states": {"parse_intent": "Failed to extract intent and client name reliably. " + str(exc)},
            }
    return parse_intent

def _make_clarify_intent_node():
    """Node that short-circuits the graph to ask the user for missing parameters."""
    async def clarify_intent(state: RMPrepState) -> dict:
        log.info("clarification_requested", reason="Missing client name or intent")
        
        # We skip synthesis and write directly to the final markdown output field
        clarification_msg = (
            "I couldn't clearly identify the client or company name in your request. "
            "Could you please specify which company you'd like me to look up?"
        )
        
        return {"brief_markdown": clarification_msg}
    return clarify_intent

def _route_after_parse(state: RMPrepState) -> str:
    """Conditional edge logic to determine if we can proceed or must ask for clarity."""
    if state.get("intent_type") == "error_clarification_needed":
        return "clarify_intent"
    return "route"

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
            # Extract account_id and account_name for the payments node.
            # account_name is the CANONICAL name from CRM (e.g. "Microsoft Corp.")
            # and must be used for bankdw exact-match lookups — not the raw
            # client_name the user typed, which may be partial or differently cased.
            account_id = None
            account_name = None
            try:
                data = json.loads(output)
                account_id = data.get("account_id")
                account_name = data.get("account_name")  # exact Salesforce Account.Name
            except (json.JSONDecodeError, AttributeError):
                pass
            log.info("crm_gathered", client=client, account_id=account_id, account_name=account_name)
            return {"crm_output": output, "account_id": account_id, "account_name": account_name}
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
        # Use account_name from CRM if available — it is the EXACT canonical name
        # that matches bankdw."fact_payments"."PayorName" / "dim_party"."PartyName".
        # Falling back to client_name (user-supplied) risks a name mismatch because
        # the payments SQL uses exact matching, unlike the CRM ILIKE fuzzy search.
        exact_name = state.get("account_name") or state.get("client_name", "")
        try:
            result = await pay_agent.ainvoke({
                "messages": [HumanMessage(content=f'Call get_payment_summary with client_name="{exact_name}"')]
            })
            output = result["messages"][-1].content
            log.info("payments_gathered", client=exact_name)
            return {"payments_output": output}
        except Exception as exc:
            log.error("payments_gather_error", client=exact_name, error=str(exc))
            return {
                "payments_output": json.dumps({"error": "payments_unavailable", "client_name": exact_name, "detail": str(exc)}),
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


def _make_synthesize_node(synthesis_llm, synthesis_template: str):
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
    synthesis_llm,
    config: AgentConfig,
):
    """Build the RM Prep StateGraph orchestrator."""
    router_llm = make_chat_llm(config.router_model_route)

    builder = StateGraph(RMPrepState)

    # 1. Register all nodes (including the new clarify_intent node)
    builder.add_node("parse_intent",     _make_parse_intent_node(router_llm))
    builder.add_node("clarify_intent",   _make_clarify_intent_node())  # NEW
    builder.add_node("route",            _make_route_node())
    builder.add_node("gather_crm",       _make_gather_crm_node(crm_agent))
    builder.add_node("gather_payments",  _make_gather_payments_node(pay_agent))
    builder.add_node("gather_news",      _make_gather_news_node(news_agent))
    builder.add_node("synthesize",       _make_synthesize_node(synthesis_llm, "rm_prep_synthesis.j2"))
    builder.add_node("format_brief",     _make_format_brief_node())

    builder.set_entry_point("parse_intent")

    # 2. Replace the static edge with a conditional edge
    builder.add_conditional_edges(
        "parse_intent", 
        _route_after_parse,
        {
            "clarify_intent": "clarify_intent",
            "route": "route"
        }
    )

    # 3. If clarification is needed, end the graph immediately after asking
    builder.add_edge("clarify_intent", END)

    # The rest of the graph remains exactly the same
    builder.add_edge("route", "gather_crm")

    builder.add_edge("gather_crm", "gather_payments")
    builder.add_edge("gather_crm", "gather_news")

    builder.add_edge("gather_payments", "synthesize")
    builder.add_edge("gather_news", "synthesize")

    builder.add_edge("synthesize", "format_brief")
    builder.add_edge("format_brief", END)

    # Use config-driven checkpointer: "memory" for dev/test, "postgres" for prod
    if config.checkpointer_type == "postgres" and config.checkpointer_db_url:
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
            checkpointer = AsyncPostgresSaver.from_conn_string(config.checkpointer_db_url)
            log.info("checkpointer_ready", type="postgres")
        except ImportError:
            log.warning("postgres_checkpointer_unavailable", fallback="memory",
                        reason="langgraph-checkpoint-postgres not installed")
            checkpointer = MemorySaver()
    else:
        checkpointer = MemorySaver()
        log.info("checkpointer_ready", type="memory")
    return builder.compile(checkpointer=checkpointer)


# ─── Bridge + agent factory (reused by lifespan and per-request test path) ────

async def build_rm_orchestrator_with_bridges(
    sf_url: str,
    pay_url: str,
    news_url: str,
    agent_context: "AgentContext",
    config: "AgentConfig",
) -> tuple:
    """Connect bridges with *agent_context*, build agents, and return the
    compiled orchestrator plus a mapping of the live bridges.

    Usage::

        orchestrator, bridges = await build_rm_orchestrator_with_bridges(
            sf_url, pay_url, news_url, ctx, config
        )
        try:
            result = await orchestrator.ainvoke(...)
        finally:
            for bridge in bridges.values():
                await bridge.disconnect()

    This is used by ``orchestrator_lifespan`` for the long-lived shared
    context and by the ``/brief/persona`` endpoint for per-request persona
    testing where the X-Agent-Context header must carry a specific role.
    """
    from platform_sdk.mcp_bridge import MCPToolBridge

    # MCP_STARTUP_TIMEOUT: seconds each bridge waits for its first connection.
    # All three bridges connect concurrently (asyncio.gather), so total wait
    # is at most one timeout — not three.  The reconnect loop keeps running in
    # the background, so if a bridge doesn't connect in time the agent starts
    # degraded and recovers automatically once the MCP comes up.
    _startup_timeout = float(os.environ.get("MCP_STARTUP_TIMEOUT", "120"))

    bridges = {
        "salesforce": MCPToolBridge(sf_url,  agent_context=agent_context),
        "payments":   MCPToolBridge(pay_url, agent_context=agent_context),
        "news":       MCPToolBridge(news_url, agent_context=agent_context),
    }

    # Connect all three bridges in parallel — removes sequential startup
    # ordering dependency (previously 3 × sequential = 3× the wait time).
    log.info("mcp_connecting_all", role=agent_context.role, timeout=_startup_timeout)
    await asyncio.gather(
        *[bridge.connect(startup_timeout=_startup_timeout) for bridge in bridges.values()],
        return_exceptions=True,  # one bridge timeout must not cancel the others
    )
    for name, bridge in bridges.items():
        log.info(
            "mcp_startup_status",
            server=name,
            connected=bridge.is_connected,
            role=agent_context.role,
        )

    sf_tools   = await bridges["salesforce"].get_langchain_tools()
    pay_tools  = await bridges["payments"].get_langchain_tools()
    news_tools = await bridges["news"].get_langchain_tools()

    crm_prompt  = _load_prompt("crm_specialist.j2",  client_name="{{ client_name }}")
    pay_prompt  = _load_prompt("pay_specialist.j2",  client_name="{{ client_name }}")
    news_prompt = _load_prompt("news_specialist.j2", company_name="{{ company_name }}")

    crm_agent  = build_specialist_agent(sf_tools,   config, crm_prompt,  model_override=config.specialist_model_route)
    pay_agent  = build_specialist_agent(pay_tools,  config, pay_prompt,  model_override=config.specialist_model_route)
    news_agent = build_specialist_agent(news_tools, config, news_prompt, model_override=config.specialist_model_route)

    synthesis_llm = make_chat_llm(config.synthesis_model_route)

    orchestrator = build_rm_orchestrator(crm_agent, pay_agent, news_agent, synthesis_llm, config)
    return orchestrator, bridges


# ─── Lifespan context manager ─────────────────────────────────────────────────

@asynccontextmanager
async def orchestrator_lifespan(app):
    """Connect to all 3 MCP servers, build specialist agents and orchestrator.

    AgentContext and MCPToolBridge
    ──────────────────────────────
    Each bridge sends the AgentContext as a signed X-Agent-Context header on
    the SSE connection.  MCP servers verify the HMAC and use the context for
    row/column filtering.

    Shared context: In dev (ENVIRONMENT=local/dev) the orchestrator uses a
    manager-level context so all data is accessible.  Individual row/col
    restrictions are tested via the /brief/persona endpoint which builds
    fresh per-request bridges carrying the target persona's AgentContext.

    In production ENVIRONMENT this builds an rm-level context (no accounts)
    which will correctly deny access, signalling that production deployments
    must provide per-request JWT-derived contexts rather than the shared one.
    """
    config = AgentConfig.from_env()

    sf_url   = os.environ.get("SALESFORCE_MCP_URL",  "http://salesforce-mcp:8081/sse")
    pay_url  = os.environ.get("PAYMENTS_MCP_URL",    "http://payments-mcp:8082/sse")
    news_url = os.environ.get("NEWS_MCP_URL",        "http://news-search-mcp:8083/sse")

    # Build a signed orchestrator context.  In dev (ENVIRONMENT=local/dev) this
    # grants manager-level access so all data is accessible during development.
    _env = os.environ.get("ENVIRONMENT", "prod")
    orchestrator_ctx = AgentContext(
        rm_id="rm-prep-orchestrator",
        rm_name="RM Prep Orchestrator",
        role="manager" if _env in ("local", "dev") else "rm",
        team_id="system",
        assigned_account_ids=(),
        compliance_clearance=("standard", "aml_view", "compliance_full") if _env in ("local", "dev") else ("standard",),
    )
    log.info(
        "orchestrator_context_built",
        role=orchestrator_ctx.role,
        env=_env,
        clearance=list(orchestrator_ctx.compliance_clearance),
    )

    orchestrator, bridges = await build_rm_orchestrator_with_bridges(
        sf_url, pay_url, news_url, orchestrator_ctx, config
    )

    app.state.orchestrator = orchestrator
    app.state.config = config
    app.state.mcp_urls = {"sf": sf_url, "pay": pay_url, "news": news_url}
    # Store bridges so the /health/ready probe can check live connectivity
    app.state.bridges = bridges
    log.info("rm_prep_orchestrator_ready")

    yield

    for name, bridge in bridges.items():
        await bridge.disconnect()
        log.info("mcp_disconnected", server=name)
