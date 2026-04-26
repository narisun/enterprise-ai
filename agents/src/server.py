"""
Enterprise Agent Service — FastAPI server entry point.

This module creates and exposes the FastAPI application using the
EnterpriseAgentService class. The app is created at module level
so it can be imported by uvicorn: `uvicorn agents.src.server:app`

Key design decisions:
- Lifespan context manager (replaces deprecated @app.on_event)
- Agent executor stored in app.state (no global mutable variables)
- Bearer token authentication via platform_sdk.make_api_key_verifier()
- Config management delegated to EnterpriseAgentService
- Structured logging with correlation IDs via OpenTelemetry trace context
"""
from platform_sdk import configure_logging, setup_telemetry

from .enterprise_agent_service import EnterpriseAgentService

# ---- Startup ----------------------------------------------------------------
configure_logging()

# Initialize the service — this loads config from environment and creates
# the FastAPI app. The app variable is exposed at module level for uvicorn.
_service = EnterpriseAgentService(name="enterprise-agent")
setup_telemetry(_service.mcp_config.service_name)

# Create and expose the FastAPI application
app = _service.create_app()
