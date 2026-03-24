"""Application lifespan and MCP bridge initialization."""
import asyncio
from contextlib import asynccontextmanager

from platform_sdk import AgentConfig, AgentContext, MCPConfig, build_specialist_agent, get_logger, make_chat_llm
from platform_sdk.mcp_bridge import MCPToolBridge
from platform_sdk.prompts import PromptLoader
from .graph import build_rm_orchestrator, _PROMPT_DIR, _default_prompts

log = get_logger(__name__)


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

    # MCP_STARTUP_TIMEOUT: seconds each bridge waits for its first connection.
    # All three bridges connect concurrently (asyncio.gather), so total wait
    # is at most one timeout — not three.  The reconnect loop keeps running in
    # the background, so if a bridge doesn't connect in time the agent starts
    # degraded and recovers automatically once the MCP comes up.
    _startup_timeout = config.mcp_startup_timeout

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

    crm_prompt  = _default_prompts.render("crm_specialist.j2",  client_name="{{ client_name }}")
    pay_prompt  = _default_prompts.render("pay_specialist.j2",  client_name="{{ client_name }}")
    news_prompt = _default_prompts.render("news_specialist.j2", company_name="{{ company_name }}")

    crm_agent  = build_specialist_agent(sf_tools,   config, crm_prompt,  model_override=config.specialist_model_route)
    pay_agent  = build_specialist_agent(pay_tools,  config, pay_prompt,  model_override=config.specialist_model_route)
    news_agent = build_specialist_agent(news_tools, config, news_prompt, model_override=config.specialist_model_route)

    synthesis_llm = make_chat_llm(config.synthesis_model_route)

    orchestrator = build_rm_orchestrator(crm_agent, pay_agent, news_agent, synthesis_llm, config)
    return orchestrator, bridges


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
    mcp_config = MCPConfig.from_env()

    sf_url   = mcp_config.salesforce_mcp_url
    pay_url  = mcp_config.payments_mcp_url
    news_url = mcp_config.news_mcp_url

    # Build a signed orchestrator context.  In dev (ENVIRONMENT=local/dev) this
    # grants manager-level access so all data is accessible during development.
    _env = mcp_config.environment
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
