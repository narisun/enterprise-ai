"""
Enterprise AI Chat UI — Chainlit frontend.

Architecture:
- Chainlit handles the web UI, auth, and SSE streaming to the browser.
- The same MCPToolBridge and LangGraph agent builder used by the REST API
  are reused here (copied from agents/src/ into /app/agent_src/ in Docker).
- Tokens stream live to the browser via Chainlit's stream_token().
- Tool calls (MCP queries, OPA checks) appear as collapsible Step widgets.
- Each browser session gets its own MCP connection and LangGraph thread ID.

Auth:
- Development: username + INTERNAL_API_KEY as password.
- Production: replace @cl.password_auth_callback with @cl.oauth_callback
  pointing at your Azure AD / Okta tenant.
  See: https://docs.chainlit.io/authentication/oauth

Conversation History:
- When DATABASE_URL is set, Chainlit persists every thread (conversation)
  and its steps (messages + tool calls) into PostgreSQL via SQLAlchemyDataLayer.
- The built-in "History" sidebar in the UI lets users browse and resume
  any past conversation. Chainlit creates the required tables automatically
  on first startup.
- On resume, @cl.on_chat_resume reconnects MCP and rebuilds the LangGraph
  agent so the user can continue chatting in the same thread.
"""

import json
import os

import chainlit as cl
from langchain_core.messages import HumanMessage

from agent_src.graph import build_enterprise_agent
from agent_src.mcp_bridge import MCPToolBridge
from platform_sdk import configure_logging, get_logger, setup_telemetry

# ---- Observability ----------------------------------------------------------
configure_logging()
setup_telemetry(os.getenv("SERVICE_NAME", "chat-ui"))
log = get_logger(__name__)

# ---- Configuration ----------------------------------------------------------
MCP_SSE_URL = os.environ.get("MCP_SSE_URL", "http://localhost:8080/sse")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")
RECURSION_LIMIT = int(os.environ.get("AGENT_RECURSION_LIMIT", "10"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ---- Conversation History — Chainlit SQLAlchemy data layer ------------------
# Using the @cl.data_layer decorator (public API) rather than the private
# cl_data._data_layer assignment.  The decorator is how Chainlit wires the
# data layer into its auth flow so that get_or_create_user() is called on
# every login — without it, the /project/threads endpoint returns 404.
#
# Schema tables are created by `chainlit db upgrade` in the container
# entrypoint (entrypoint.sh) before the server starts.
#
# Connection string must use the asyncpg driver:
#   postgresql+asyncpg://user:password@host:port/dbname
@cl.data_layer
def get_data_layer():
    if not DATABASE_URL:
        log.warning(
            "history_disabled",
            reason="DATABASE_URL not set — conversations will not be persisted",
        )
        return None
    try:
        from chainlit.data.sql_alchemy import SQLAlchemyDataLayer

        log.info("history_enabled", backend="postgresql")
        return SQLAlchemyDataLayer(conninfo=DATABASE_URL)
    except Exception as exc:
        log.error("history_init_failed", error=str(exc), exc_info=True)
        return None


# ---- Authentication ---------------------------------------------------------

@cl.password_auth_callback
def auth_callback(username: str, password: str) -> cl.User | None:
    """
    Validate login credentials.

    Username: any non-empty value (becomes the display name in the UI).
    Password: must match INTERNAL_API_KEY from the environment.

    To switch to Azure AD SSO, replace this function with:

        @cl.oauth_callback
        def oauth_callback(provider_id, token, raw_user_data, default_user):
            if raw_user_data.get("hd") == "yourcompany.com":
                return default_user
            return None

    and set OAUTH_AZURE_AD_CLIENT_ID / OAUTH_AZURE_AD_CLIENT_SECRET in .env.
    """
    if not INTERNAL_API_KEY:
        log.warning("auth_misconfigured", reason="INTERNAL_API_KEY not set — allowing all logins")
        return cl.User(identifier=username or "user", metadata={"role": "user"})

    if password == INTERNAL_API_KEY and username:
        log.info("auth_success", username=username)
        return cl.User(identifier=username, metadata={"role": "user"})

    log.warning("auth_failed", username=username)
    return None


# ---- Shared session initialisation ------------------------------------------

async def _init_session(thread_id: str, username: str) -> bool:
    """
    Connect to the MCP server, discover tools, and build a LangGraph agent.
    Stores bridge and agent in Chainlit's per-session store.
    Returns True on success, False on failure.

    Extracted so both on_chat_start and on_chat_resume can call it.
    """
    try:
        bridge = MCPToolBridge(MCP_SSE_URL)
        await bridge.connect()
        tools = await bridge.get_langchain_tools()
        agent = build_enterprise_agent(tools)

        cl.user_session.set("bridge", bridge)
        cl.user_session.set("agent", agent)

        log.info("session_initialised", username=username, thread_id=thread_id,
                 tools=[t.name for t in tools])
        return True

    except Exception as exc:
        log.error("session_init_failed", error=str(exc), exc_info=True)
        return False


# ---- Session lifecycle — new conversation -----------------------------------

@cl.on_chat_start
async def on_chat_start() -> None:
    """
    Called when a user opens a brand-new conversation.

    Connects to the MCP server, discovers available tools, and builds a
    fresh LangGraph agent bound to this session's thread ID.
    """
    user = cl.user_session.get("user")
    username = user.identifier if user else "user"
    session_id = cl.user_session.get("id")

    # Show a status message while we connect
    status = cl.Message(content="⚙️ Connecting to tools…")
    await status.send()

    ok = await _init_session(session_id, username)

    if ok:
        agent = cl.user_session.get("agent")
        bridge = cl.user_session.get("bridge")
        tools = await bridge.get_langchain_tools()
        tool_names = [t.name for t in tools]
        tool_list = "\n".join(f"- `{name}`" for name in tool_names)

        await status.remove()
        await cl.Message(
            content=(
                f"👋 Welcome, **{username}**!\n\n"
                f"I'm your enterprise AI assistant. I have access to:\n"
                f"{tool_list}\n\n"
                f"Expand the ▶ steps below any response to see exactly "
                f"what data was retrieved and which policies were applied."
            )
        ).send()
    else:
        await status.remove()
        await cl.Message(
            content=(
                "❌ Could not connect to the tool layer. "
                "Please contact your platform administrator."
            )
        ).send()


# ---- Session lifecycle — resume past conversation ---------------------------

@cl.on_chat_resume
async def on_chat_resume(thread: cl.types.ThreadDict) -> None:
    """
    Called when a user clicks a past conversation in the History sidebar.

    Chainlit automatically re-renders all previous messages from the stored
    thread. This hook only needs to re-establish the live MCP connection and
    rebuild the LangGraph agent so the user can continue the conversation.

    The LangGraph thread_id matches the Chainlit thread_id, so if the agent
    container is still running the in-memory graph state (tool context, memory)
    is preserved. After a container restart only the chat transcript is
    restored — the user can still ask new questions seamlessly.
    """
    user = cl.user_session.get("user")
    username = user.identifier if user else "user"
    thread_id: str = thread["id"]

    log.info("session_resuming", username=username, thread_id=thread_id)

    ok = await _init_session(thread_id, username)
    if not ok:
        await cl.Message(
            content=(
                "⚠️ Could not reconnect to the tool layer. "
                "Previous messages are shown above — "
                "please refresh the page to start a new session."
            )
        ).send()


# ---- Session lifecycle — cleanup --------------------------------------------

@cl.on_chat_end
async def on_chat_end() -> None:
    """Cleanly close the MCP SSE connection when the session ends."""
    bridge: MCPToolBridge | None = cl.user_session.get("bridge")
    if bridge:
        await bridge.disconnect()
    log.info("session_ended")


# ---- Message handler --------------------------------------------------------

@cl.on_message
async def on_message(message: cl.Message) -> None:
    """
    Handle an incoming user message.

    Runs the LangGraph ReAct loop via astream_events (v2), which emits:
      - on_chat_model_stream  → individual tokens → streamed to answer bubble
      - on_tool_start         → tool invocation   → shown as a Step widget
      - on_tool_end           → tool result       → updates the Step widget
    """
    agent = cl.user_session.get("agent")
    if not agent:
        await cl.Message(
            content="⚠️ Session not initialised. Please refresh the page."
        ).send()
        return

    session_id = cl.user_session.get("id")

    # Start the streaming answer bubble immediately so the UI feels responsive
    answer = cl.Message(content="")
    await answer.send()

    # Track open Step widgets by LangGraph run_id so we can update them
    # when the tool call completes
    active_steps: dict[str, cl.Step] = {}

    try:
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=message.content)]},
            config={
                "configurable": {"thread_id": session_id},
                "recursion_limit": RECURSION_LIMIT,
            },
            version="v2",
        ):
            kind: str = event["event"]

            # ── Stream LLM tokens into the answer bubble ──────────────────
            if kind == "on_chat_model_stream":
                chunk = event["data"].get("chunk")
                if not chunk:
                    continue
                content = chunk.content
                if isinstance(content, str) and content:
                    await answer.stream_token(content)
                elif isinstance(content, list):
                    # Some models return content as a list of typed blocks
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            await answer.stream_token(block["text"])

            # ── Open a collapsible Step when a tool is invoked ────────────
            elif kind == "on_tool_start":
                run_id: str = event.get("run_id", "")
                tool_name: str = event.get("name", "tool")
                tool_input = event["data"].get("input", {})

                step = cl.Step(
                    name=f"🔧 {tool_name}",
                    type="tool",
                    show_input="json",
                )
                step.input = json.dumps(tool_input, indent=2, default=str)
                active_steps[run_id] = step
                await step.send()

            # ── Update the Step with the tool result once it finishes ─────
            elif kind == "on_tool_end":
                run_id = event.get("run_id", "")
                step = active_steps.pop(run_id, None)
                if step:
                    raw_output = event["data"].get("output", "")
                    output_str = str(raw_output)
                    # Truncate huge results — they're unreadable in the UI anyway
                    if len(output_str) > 3000:
                        output_str = output_str[:3000] + "\n\n… [output truncated for display]"
                    step.output = output_str
                    await step.update()

    except Exception as exc:
        log.error("message_error", session_id=session_id, error=str(exc), exc_info=True)
        await cl.Message(
            content="⚠️ An error occurred processing your request. Please try again."
        ).send()

    finally:
        # Finalise the answer bubble (flushes any buffered content)
        await answer.update()
