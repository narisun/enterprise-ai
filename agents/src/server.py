"""
Enterprise Agent Service — FastAPI server.

Key design decisions:
- lifespan context manager (replaces deprecated @app.on_event)
- Agent executor stored in app.state (no global mutable variables)
- Bearer token authentication via platform_sdk.make_api_key_verifier()
- Recursion limit and message length read from platform_sdk.AgentConfig
- Structured logging with correlation IDs via OpenTelemetry trace context
"""
import os
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from .graph import build_enterprise_agent
from .mcp_bridge import MCPToolBridge, reset_session_id, set_session_id

# Import shared SDK — installed via `make sdk-install` or the Dockerfile
from platform_sdk import AgentConfig, configure_logging, get_logger, make_api_key_verifier, setup_telemetry

# ---- Startup ----------------------------------------------------------------
configure_logging()
setup_telemetry(os.getenv("SERVICE_NAME", "ai-agents"))

# Use structlog logger (supports keyword args) rather than standard logging.getLogger()
log = get_logger(__name__)

MCP_SSE_URL = os.environ.get("MCP_SSE_URL", "http://localhost:8080/sse")

# Read agent config from environment — recursion_limit, max_message_length, etc.
_agent_config = AgentConfig.from_env()

# ---- Authentication (from SDK — consistent across all services) --------------
verify_api_key = make_api_key_verifier()

# ---- Lifespan (replaces deprecated @app.on_event) ---------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage MCP connection and agent initialisation for the app's lifetime."""
    log.info("agent_service_starting", mcp_url=MCP_SSE_URL)

    bridge = MCPToolBridge(MCP_SSE_URL)
    await bridge.connect()
    tools = await bridge.get_langchain_tools()

    # Store on app.state — no global variables
    app.state.bridge = bridge
    app.state.agent_executor = build_enterprise_agent(tools)

    log.info("agent_service_ready", tool_count=len(tools))
    yield   # Server is running

    log.info("agent_service_stopping")
    await bridge.disconnect()


# ---- Application ------------------------------------------------------------

app = FastAPI(
    title="Enterprise Agent Service",
    description="LangGraph ReAct agent backed by LiteLLM and MCP tools.",
    version="0.1.0",
    lifespan=lifespan,
)


# ---- Request / Response Models ----------------------------------------------

class ChatRequest(BaseModel):
    # H4: length limits prevent context-overflow and runaway token spend
    message: str = Field(..., min_length=1, max_length=_agent_config.max_message_length)
    # Default to a fresh UUID so OPA _valid_session_id always passes even when
    # the caller omits session_id (e.g. quick curl tests).
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()), max_length=128)


class ChatResponse(BaseModel):
    content: str
    role: str = "assistant"
    session_id: str


# ---- Endpoints --------------------------------------------------------------

@app.get("/health")
async def health():
    """Kubernetes liveness probe — always returns ok if the process is running."""
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready(http_request: Request):
    """Kubernetes readiness probe — checks downstream dependencies."""
    checks = {}
    healthy = True

    # Check that agent executor is initialised
    agent_ok = hasattr(http_request.app.state, "agent_executor") and http_request.app.state.agent_executor is not None
    checks["agent"] = "ok" if agent_ok else "not_ready"
    if not agent_ok:
        healthy = False

    # Check MCP bridge connectivity
    bridge_ok = hasattr(http_request.app.state, "bridge") and http_request.app.state.bridge._session is not None
    checks["mcp_bridge"] = "ok" if bridge_ok else "disconnected"
    if not bridge_ok:
        healthy = False

    status_code = 200 if healthy else 503
    from fastapi.responses import JSONResponse
    return JSONResponse({"status": "ok" if healthy else "degraded", "checks": checks}, status_code=status_code)


@app.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    http_request: Request,
    _api_key: str = Depends(verify_api_key),
) -> ChatResponse:
    """
    Send a message to the enterprise agent.

    The agent will use its MCP tools to fulfil the request and return
    a single consolidated response.
    """
    agent_executor = http_request.app.state.agent_executor
    log.info("chat_request", session_id=body.session_id, message_length=len(body.message))

    # Bind the trusted session_id to the current async context so the shared
    # MCPToolBridge can inject it into execute_read_query calls without the
    # LLM ever needing to choose or know the value.
    sid_token = set_session_id(body.session_id)
    try:
        result = await agent_executor.ainvoke(
            {"messages": [HumanMessage(content=body.message)]},
            config={
                "recursion_limit": _agent_config.recursion_limit,
                "configurable": {"thread_id": body.session_id},
            },
        )
        final_message = result["messages"][-1]
        log.info("chat_response", session_id=body.session_id, content_length=len(final_message.content))
        return ChatResponse(content=final_message.content, session_id=body.session_id)

    except Exception as exc:
        # Log the full traceback internally; return a safe message to the caller
        log.error("chat_error", session_id=body.session_id, error=str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred. Please try again.")

    finally:
        reset_session_id(sid_token)
