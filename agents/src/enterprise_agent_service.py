"""
Enterprise Agent Service — LangGraph ReAct agent backed by MCP tools.

This service class extends the SDK Agent base class and manages:
- MCP configuration and the MCP bridge connection
- LangGraph agent initialization
- FastAPI application factory
- Chat request/response models

Key design principles:
- Extends platform_sdk.base.Agent for config management and logging
- Stores bridge and executor in app.state (no global mutable state)
- Uses lifespan context manager for async resource initialization
- Bearer token authentication via platform_sdk.make_api_key_verifier()
"""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from .graph import build_enterprise_agent
from .mcp_bridge import MCPToolBridge, reset_session_id, set_session_id

# Import shared SDK
from platform_sdk import Agent, AgentConfig, MCPConfig, get_logger, make_api_key_verifier

if TYPE_CHECKING:
    from platform_sdk import MCPConfig


class EnterpriseAgentService(Agent):
    """Enterprise Agent — LangGraph ReAct agent backed by MCP tools.

    Extends the SDK Agent base class and manages MCP configuration,
    bridge initialization, and FastAPI application setup.
    """

    def __init__(self, name: str = "enterprise-agent", *, config: Optional[AgentConfig] = None) -> None:
        """
        Initialize the enterprise agent service.

        Args:
            name: The service name (default: "enterprise-agent").
            config: Optional AgentConfig to inject. If not provided, loads from environment.
        """
        super().__init__(name, config=config)
        self._mcp_config = MCPConfig.from_env()
        self._log = get_logger(self.name)

    @property
    def mcp_config(self) -> MCPConfig:
        """Get the MCP configuration."""
        return self._mcp_config

    @property
    def mcp_sse_url(self) -> str:
        """Get the MCP SSE URL for bridge connection."""
        return self._mcp_config.mcp_sse_url

    def create_app(self) -> FastAPI:
        """
        Build and return the FastAPI application.

        Sets up:
        - Lifespan context manager for MCP bridge initialization
        - Request/response models with validation
        - Health check endpoints
        - Chat endpoint with authentication

        Returns:
            A configured FastAPI application instance.
        """
        # Capture self for use in nested functions
        service = self

        # ---- Lifespan (replaces deprecated @app.on_event) ---------------------------

        @asynccontextmanager
        async def lifespan(app: FastAPI):
            """Manage MCP connection and agent initialization for the app's lifetime."""
            service._log.info("agent_service_starting", mcp_url=service.mcp_sse_url)

            bridge = MCPToolBridge(service.mcp_sse_url)
            await bridge.connect()
            tools = await bridge.get_langchain_tools()

            # Store on app.state — no global variables
            app.state.bridge = bridge
            app.state.agent_executor = build_enterprise_agent(tools)

            service._log.info("agent_service_ready", tool_count=len(tools))
            yield  # Server is running

            service._log.info("agent_service_stopping")
            await bridge.disconnect()

        # ---- Request / Response Models ----------------------------------------------

        class ChatRequest(BaseModel):
            message: str = Field(..., min_length=1, max_length=service.agent_config.max_message_length)
            # Default to a fresh UUID so OPA _valid_session_id always passes even when
            # the caller omits session_id (e.g. quick curl tests).
            session_id: str = Field(default_factory=lambda: str(uuid.uuid4()), max_length=128)

        class ChatResponse(BaseModel):
            content: str
            role: str = "assistant"
            session_id: str

        # ---- Authentication (from SDK — consistent across all services) --------------
        verify_api_key = make_api_key_verifier()

        # ---- Application ------------------------------------------------------------

        app = FastAPI(
            title="Enterprise Agent Service",
            description="LangGraph ReAct agent backed by LiteLLM and MCP tools.",
            version="0.1.0",
            lifespan=lifespan,
        )

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

            return JSONResponse(
                {"status": "ok" if healthy else "degraded", "checks": checks},
                status_code=status_code,
            )

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
            service._log.info("chat_request", session_id=body.session_id, message_length=len(body.message))

            # Bind the trusted session_id to the current async context so the shared
            # MCPToolBridge can inject it into execute_read_query calls without the
            # LLM ever needing to choose or know the value.
            sid_token = set_session_id(body.session_id)
            try:
                result = await agent_executor.ainvoke(
                    {"messages": [HumanMessage(content=body.message)]},
                    config={
                        "recursion_limit": service.agent_config.recursion_limit,
                        "configurable": {"thread_id": body.session_id},
                    },
                )
                final_message = result["messages"][-1]
                service._log.info("chat_response", session_id=body.session_id, content_length=len(final_message.content))
                return ChatResponse(content=final_message.content, session_id=body.session_id)

            except Exception as exc:
                # Log the full traceback internally; return a safe message to the caller
                service._log.error("chat_error", session_id=body.session_id, error=str(exc), exc_info=True)
                raise HTTPException(status_code=500, detail="An internal error occurred. Please try again.")

            finally:
                reset_session_id(sid_token)

        return app
