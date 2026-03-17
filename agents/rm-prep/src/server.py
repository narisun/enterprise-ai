"""
RM Prep Agent — FastAPI server.

Endpoints:
  GET  /health         — readiness probe
  POST /brief          — streaming SSE brief generation
  POST /brief/sync     — synchronous brief (for testing)
"""
import json
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Security
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from platform_sdk import AgentConfig, configure_logging, get_logger, make_api_key_verifier, setup_telemetry
from .graph import orchestrator_lifespan

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


class BriefResponse(BaseModel):
    brief_markdown: str
    client_name: Optional[str]
    session_id: str


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
    orchestrator = request.app.state.orchestrator
    log.info("brief_request", rm_id=body.rm_id, session_id=body.session_id)

    async def event_stream():
        try:
            async for event in orchestrator.astream_events(
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
                version="v2",
            ):
                event_type = event.get("event", "")
                node_name = event.get("metadata", {}).get("langgraph_node", "")

                if event_type == "on_chain_start" and node_name in _PROGRESS_LABELS:
                    yield {
                        "event": "progress",
                        "data": json.dumps({"message": _PROGRESS_LABELS[node_name]}),
                    }

                elif event_type == "on_chain_end" and node_name == "format_brief":
                    output = event.get("data", {}).get("output", {})
                    brief_md = output.get("brief_markdown", "")
                    client_name = output.get("client_name", "")
                    log.info("brief_complete", rm_id=body.rm_id, session_id=body.session_id)
                    yield {
                        "event": "brief",
                        "data": json.dumps({"markdown": brief_md, "client_name": client_name}),
                    }

        except Exception as exc:
            log.error("brief_stream_error", error=str(exc), exc_info=True)
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

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
