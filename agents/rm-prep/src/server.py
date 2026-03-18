"""
RM Prep Agent — FastAPI server.

Endpoints:
  GET  /health              — readiness probe
  POST /brief               — streaming SSE brief generation
  POST /brief/sync          — synchronous brief (for testing)
  POST /brief/persona       — brief with per-request persona context (dev/local only)
  POST /auth/token          — issue a test persona JWT (dev/local only)
  GET  /auth/personas       — list available test personas (dev/local only)
"""
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Security
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from platform_sdk import AgentConfig, AgentContext, configure_logging, get_logger, make_api_key_verifier, setup_telemetry
from .graph import build_rm_orchestrator_with_bridges, orchestrator_lifespan

configure_logging()
setup_telemetry(os.getenv("SERVICE_NAME", "rm-prep-agent"))
log = get_logger(__name__)

verify_api_key = make_api_key_verifier()
_agent_config = AgentConfig.from_env()

_PROGRESS_LABELS = {
    "parse_intent":     "Identifying client...",
    "route":            "Planning data retrieval...",
    "gather_crm":       "Fetching CRM relationship data...",
    "gather_payments":  "Analysing payment trends...",
    "gather_news":      "Searching latest news...",
    "synthesize":       "Generating your brief...",
    "format_brief":     "Brief ready",
}

# ─── Test Persona Registry (dev / local only) ─────────────────────────────────
#
# These personas cover the full role hierarchy so developers can verify that
# row-level and column-level access controls work end-to-end without touching
# a real identity provider.
#
# Account IDs are from the test seed data (platform/db/21_test_sfcrm_seed.sql):
#   001000000000001AAA = Microsoft Corp.
#   001000000000002AAA = Ford Motor Company
#
# The "rm" persona deliberately restricts access to two accounts so you can
# confirm the row filter fires for any other company name.

_TEST_PERSONAS: dict[str, dict] = {
    "manager": {
        "rm_id":                "test-manager-001",
        "rm_name":              "Alice Manager (test)",
        "role":                 "manager",
        "team_id":              "test-team",
        "assigned_account_ids": [],          # managers see all accounts
        "compliance_clearance": ["standard", "aml_view", "compliance_full"],
        "description":          "Full access — all accounts, all compliance columns",
    },
    "senior_rm": {
        "rm_id":                "test-senior-rm-001",
        "rm_name":              "Bob Senior RM (test)",
        "role":                 "senior_rm",
        "team_id":              "test-team",
        "assigned_account_ids": [],          # senior RMs see all accounts
        "compliance_clearance": ["standard", "aml_view"],
        "description":          "All accounts, AML columns visible, compliance columns masked",
    },
    "rm": {
        "rm_id":                "test-rm-001",
        "rm_name":              "Carol RM (test)",
        "role":                 "rm",
        "team_id":              "test-team",
        "assigned_account_ids": [            # restricted book of business
            "001000000000001AAA",            # Microsoft Corp.
            "001000000000002AAA",            # Ford Motor Company
        ],
        "compliance_clearance": ["standard"],
        "description":          "Row-restricted to 2 accounts (Microsoft, Ford); PII and AML columns masked",
    },
    "readonly": {
        "rm_id":                "test-readonly-001",
        "rm_name":              "Dave Readonly (test)",
        "role":                 "readonly",
        "team_id":              "test-team",
        "assigned_account_ids": [],
        "compliance_clearance": ["standard"],
        "description":          "No data access — all tool calls return access_denied",
    },
}

_JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-prod")
_ENV        = os.environ.get("ENVIRONMENT", "prod")


def _is_dev_env() -> bool:
    return _ENV in ("local", "dev")


def _require_dev_env(endpoint: str) -> None:
    """Raise 403 if we are not in a development environment."""
    if not _is_dev_env():
        raise HTTPException(
            status_code=403,
            detail=f"{endpoint} is only available in local/dev environments.",
        )


def _build_agent_context_from_persona(persona_name: str) -> AgentContext:
    """Construct a signed AgentContext from a named test persona."""
    data = _TEST_PERSONAS[persona_name]
    return AgentContext(
        rm_id=data["rm_id"],
        rm_name=data["rm_name"],
        role=data["role"],
        team_id=data["team_id"],
        assigned_account_ids=tuple(data["assigned_account_ids"]),
        compliance_clearance=tuple(data["compliance_clearance"]),
    )


def _decode_jwt_to_agent_context(token: str) -> AgentContext:
    """Decode a signed JWT and return an AgentContext.  Raises HTTPException on failure."""
    try:
        import jwt as pyjwt
    except ImportError:
        raise HTTPException(status_code=500, detail="PyJWT not installed on this server.")
    try:
        payload = pyjwt.decode(token, _JWT_SECRET, algorithms=["HS256"])
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid or expired JWT: {exc}")
    return AgentContext(
        rm_id=payload.get("sub", "unknown"),
        rm_name=payload.get("name", ""),
        role=payload.get("role", "readonly"),
        team_id=payload.get("team_id", ""),
        assigned_account_ids=tuple(payload.get("assigned_account_ids", [])),
        compliance_clearance=tuple(payload.get("compliance_clearance", ["standard"])),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with orchestrator_lifespan(app):
        yield


app = FastAPI(
    title="RM Prep Agent",
    description="AI-powered meeting preparation for Relationship Managers.",
    version="1.0.0",
    lifespan=lifespan,
)


class BriefRequest(BaseModel):
    prompt: str = Field(..., min_length=5, max_length=_agent_config.max_message_length,
                        description="RM's natural language request, e.g. 'Prepare me for my meeting with Acme Manufacturing'")
    rm_id: str = Field(default="RM", max_length=64, description="RM identifier for personalisation and audit")
    session_id: str = Field(default="default", max_length=128,
                            description="Session ID for multi-turn conversation continuity")
    jwt_token: Optional[str] = Field(
        default=None,
        description="(Dev/test only) Signed JWT for per-request persona context. "
                    "When set, fresh MCP bridges are built with that persona's role/clearance. "
                    "Obtain a token from POST /auth/token.",
    )


class BriefResponse(BaseModel):
    brief_markdown: str
    client_name: Optional[str]
    session_id: str


# ─── Auth / test-persona models ───────────────────────────────────────────────

class TokenRequest(BaseModel):
    persona: str = Field(
        ...,
        description="Test persona name: manager | senior_rm | rm | readonly",
    )
    expires_in: int = Field(
        default=3600,
        ge=60,
        le=86400,
        description="Token lifetime in seconds (60–86400)",
    )


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    persona: str
    role: str
    expires_in: int
    description: str


class PersonaInfo(BaseModel):
    name: str
    role: str
    description: str
    assigned_account_count: int
    compliance_clearance: list[str]


@app.get("/health")
async def health():
    return {"status": "ok", "service": "rm-prep-agent"}


@app.post("/brief")
async def get_brief_streaming(
    body: BriefRequest,
    request: Request,
    _: str = Security(verify_api_key),
):
    """
    Generate an RM Meeting Brief — streaming SSE.

    Emits progress events as each pipeline stage starts, then emits
    the final brief as a 'brief' event. The Streamlit UI renders
    each progress event in real-time.

    Event types:
      progress — {"message": "Fetching CRM data..."}
      brief    — {"markdown": "# RM Meeting Preparation Brief ..."}
      error    — {"message": "...error description..."}
    """
    # If a persona JWT is provided, build fresh per-request bridges so the
    # MCP servers see that persona's role/clearance in the X-Agent-Context
    # header.  Otherwise use the shared orchestrator built at startup.
    persona_bridges = None
    if body.jwt_token:
        _require_dev_env("jwt_token in /brief")
        persona_ctx = _decode_jwt_to_agent_context(body.jwt_token)
        log.info("persona_brief_request", rm_id=persona_ctx.rm_id, role=persona_ctx.role,
                 session_id=body.session_id)
        urls   = request.app.state.mcp_urls
        config = request.app.state.config
        orchestrator, persona_bridges = await build_rm_orchestrator_with_bridges(
            urls["sf"], urls["pay"], urls["news"], persona_ctx, config
        )
        effective_rm_id = persona_ctx.rm_name
    else:
        orchestrator = request.app.state.orchestrator
        effective_rm_id = body.rm_id

    log.info("brief_request", rm_id=effective_rm_id, session_id=body.session_id)

    async def event_stream():
        # client_name is extracted from the synthesize node's structured output
        # and forwarded in the final brief event (format_brief doesn't return it).
        _client_name = ""

        try:
            if body.jwt_token:
                yield {
                    "event": "progress",
                    "data": json.dumps({"message": f"Running as persona: {effective_rm_id}…"}),
                }

            async for event in orchestrator.astream_events(
                {
                    "messages": [HumanMessage(content=body.prompt)],
                    "rm_id": effective_rm_id,
                    "session_id": body.session_id,
                    "error_states": {},
                    "agents_to_invoke": [],
                },
                config={
                    "configurable": {"thread_id": body.session_id},
                    "recursion_limit": _agent_config.recursion_limit,
                },
                version="v2",
            ):
                event_type = event.get("event", "")
                node_name = event.get("metadata", {}).get("langgraph_node", "")

                if event_type == "on_chain_start" and node_name in _PROGRESS_LABELS:
                    yield {
                        "event": "progress",
                        "data": json.dumps({"message": _PROGRESS_LABELS[node_name]}),
                    }

                elif event_type == "on_chain_end" and node_name == "synthesize":
                    # astream_events(v2) fires two on_chain_end events for synthesize:
                    #   1. The inner with_structured_output chain → output is RMBrief (Pydantic)
                    #   2. The outer synthesize node         → output is {"brief_data": {...}}
                    # We only want the outer node's event, which returns a plain dict.
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        brief_data = output.get("brief_data", {})
                        _client_name = brief_data.get("client_name", "") if isinstance(brief_data, dict) else ""

                elif event_type == "on_chain_end" and node_name == "format_brief":
                    output = event.get("data", {}).get("output", {})
                    brief_md = output.get("brief_markdown", "")
                    log.info("brief_complete", rm_id=body.rm_id, session_id=body.session_id)

                    # Stream the rendered markdown word-by-word as token events.
                    # We stream from format_brief (not synthesize) because synthesize
                    # uses with_structured_output → the LLM emits raw JSON, not markdown.
                    # Streaming the already-rendered markdown gives correct content with
                    # a natural typing effect.
                    if brief_md:
                        words = brief_md.split(" ")
                        for i, word in enumerate(words):
                            text = word if i == 0 else " " + word
                            yield {
                                "event": "token",
                                "data": json.dumps({"text": text}),
                            }

                    yield {
                        "event": "brief",
                        "data": json.dumps({"markdown": brief_md, "client_name": _client_name}),
                    }

        except Exception as exc:
            log.error("brief_stream_error", error=str(exc), exc_info=True)
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}
        finally:
            # Disconnect per-request persona bridges when they are no longer needed.
            if persona_bridges:
                for bridge in persona_bridges.values():
                    await bridge.disconnect()

    return EventSourceResponse(event_stream())


@app.post("/brief/sync", response_model=BriefResponse)
async def get_brief_sync(
    body: BriefRequest,
    request: Request,
    _: str = Security(verify_api_key),
):
    """Synchronous brief generation — for testing and non-streaming clients."""
    orchestrator = request.app.state.orchestrator
    try:
        result = await orchestrator.ainvoke(
            {
                "messages": [HumanMessage(content=body.prompt)],
                "rm_id": body.rm_id,
                "session_id": body.session_id,
                "error_states": {},
                "agents_to_invoke": [],
            },
            config={
                "configurable": {"thread_id": body.session_id},
                "recursion_limit": _agent_config.recursion_limit,
            },
        )
        return BriefResponse(
            brief_markdown=result.get("brief_markdown", ""),
            client_name=result.get("client_name"),
            session_id=body.session_id,
        )
    except Exception as exc:
        log.error("brief_sync_error", error=str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Dev / test endpoints ─────────────────────────────────────────────────────

@app.get("/auth/personas", response_model=list[PersonaInfo])
async def list_personas(_: str = Security(verify_api_key)):
    """
    List available test personas and their access profiles.

    Only available in local/dev environments.
    """
    _require_dev_env("/auth/personas")
    return [
        PersonaInfo(
            name=name,
            role=data["role"],
            description=data["description"],
            assigned_account_count=len(data["assigned_account_ids"]),
            compliance_clearance=data["compliance_clearance"],
        )
        for name, data in _TEST_PERSONAS.items()
    ]


@app.post("/auth/token", response_model=TokenResponse)
async def create_test_token(
    body: TokenRequest,
    _: str = Security(verify_api_key),
):
    """
    Issue a signed JWT for a named test persona.

    Only available in local/dev environments (ENVIRONMENT=local|dev).
    The JWT is signed with JWT_SECRET and carries the persona's role,
    team, assigned_account_ids, and compliance_clearance claims.

    Pass the token in POST /brief/persona as ``jwt_token`` to run the full
    pipeline with that persona's access restrictions enforced end-to-end.

    Personas
    --------
    manager   Full access — all accounts, compliance_full clearance.
    senior_rm All accounts, AML columns visible, compliance columns masked.
    rm        Row-restricted to 2 seeded accounts (Microsoft, Ford); PII/AML masked.
    readonly  No data access — all tool calls return access_denied.
    """
    _require_dev_env("/auth/token")

    try:
        import jwt as pyjwt
    except ImportError:
        raise HTTPException(status_code=500, detail="PyJWT not installed.")

    persona_data = _TEST_PERSONAS.get(body.persona)
    if not persona_data:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown persona '{body.persona}'. Valid: {list(_TEST_PERSONAS.keys())}",
        )

    now     = datetime.now(timezone.utc)
    payload = {
        "sub":                  persona_data["rm_id"],
        "name":                 persona_data["rm_name"],
        "role":                 persona_data["role"],
        "team_id":              persona_data["team_id"],
        "assigned_account_ids": persona_data["assigned_account_ids"],
        "compliance_clearance": persona_data["compliance_clearance"],
        "iat":                  int(now.timestamp()),
        "exp":                  int((now + timedelta(seconds=body.expires_in)).timestamp()),
    }
    token = pyjwt.encode(payload, _JWT_SECRET, algorithm="HS256")

    log.info("test_token_issued", persona=body.persona, role=persona_data["role"])

    return TokenResponse(
        access_token=token,
        persona=body.persona,
        role=persona_data["role"],
        expires_in=body.expires_in,
        description=persona_data["description"],
    )


@app.post("/brief/persona", response_model=BriefResponse)
async def get_brief_with_persona(
    body: BriefRequest,
    request: Request,
    _: str = Security(verify_api_key),
):
    """
    Generate a brief with a specific persona's access context (dev/local only).

    Accepts an optional ``jwt_token`` in the request body.  When present:
    - The JWT is decoded and verified with JWT_SECRET.
    - A fresh set of MCP bridges is opened carrying that persona's
      X-Agent-Context header.
    - The full pipeline runs with that persona's row/column restrictions.
    - Bridges are disconnected after the request completes.

    When ``jwt_token`` is absent this behaves identically to /brief/sync,
    using the shared orchestrator context (manager role in local/dev).

    Use this endpoint to verify that access controls fire correctly:
      • manager / senior_rm  → full data returned
      • rm (Carol)           → only Microsoft and Ford are accessible
      • readonly             → all tool calls return access_denied
    """
    _require_dev_env("/brief/persona")

    if body.jwt_token:
        # Decode JWT → AgentContext → build fresh per-persona bridges
        persona_ctx = _decode_jwt_to_agent_context(body.jwt_token)
        log.info(
            "persona_brief_request",
            rm_id=persona_ctx.rm_id,
            role=persona_ctx.role,
            session_id=body.session_id,
        )

        urls     = request.app.state.mcp_urls
        config   = request.app.state.config

        try:
            orchestrator, bridges = await build_rm_orchestrator_with_bridges(
                urls["sf"], urls["pay"], urls["news"], persona_ctx, config
            )
        except Exception as exc:
            log.error("persona_bridge_error", error=str(exc), exc_info=True)
            raise HTTPException(status_code=503, detail=f"Failed to connect to MCP servers: {exc}")

        try:
            result = await orchestrator.ainvoke(
                {
                    "messages":        [HumanMessage(content=body.prompt)],
                    "rm_id":           persona_ctx.rm_name,
                    "session_id":      body.session_id,
                    "error_states":    {},
                    "agents_to_invoke": [],
                },
                config={
                    "configurable": {"thread_id": body.session_id},
                    "recursion_limit": config.recursion_limit,
                },
            )
        except Exception as exc:
            log.error("persona_brief_error", error=str(exc), exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc))
        finally:
            for bridge in bridges.values():
                await bridge.disconnect()

        return BriefResponse(
            brief_markdown=result.get("brief_markdown", ""),
            client_name=result.get("client_name"),
            session_id=body.session_id,
        )

    # No JWT — fall through to shared orchestrator (same as /brief/sync)
    orchestrator = request.app.state.orchestrator
    config       = request.app.state.config
    try:
        result = await orchestrator.ainvoke(
            {
                "messages":        [HumanMessage(content=body.prompt)],
                "rm_id":           body.rm_id,
                "session_id":      body.session_id,
                "error_states":    {},
                "agents_to_invoke": [],
            },
            config={
                "configurable": {"thread_id": body.session_id},
                "recursion_limit": config.recursion_limit,
            },
        )
        return BriefResponse(
            brief_markdown=result.get("brief_markdown", ""),
            client_name=result.get("client_name"),
            session_id=body.session_id,
        )
    except Exception as exc:
        log.error("persona_brief_fallback_error", error=str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))
