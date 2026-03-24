"""
Portfolio Watch Agent — FastAPI server.

Endpoints:
  GET  /health                — readiness probe
  POST /portfolio-watch       — streaming SSE report generation
  POST /portfolio-watch/sync  — synchronous (for testing)
"""
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Security
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from platform_sdk import AgentConfig, MCPConfig, configure_logging, get_logger, make_api_key_verifier, setup_telemetry
from .graph import portfolio_watch_lifespan

configure_logging()
setup_telemetry(MCPConfig.from_env().service_name)
log = get_logger(__name__)

verify_api_key  = make_api_key_verifier()
_agent_config   = AgentConfig.from_env()

# Human-readable progress labels — keyed by LangGraph node name
_PROGRESS_LABELS = {
    "conversation_router":       "Understanding your request…",
    "gather_portfolio":          "Loading your portfolio…",
    "gather_signals":            "Gathering payment, credit & news signals…",
    "generate_narrative":        "Morgan is drafting the portfolio narrative…",
    "evaluate_narrative":        "Fact-checking every claim against source data…",
    "format_report":             "Finalising the verified report…",
    "conversational_responder":  "Answering from portfolio data…",
    "refine_report":             "Refining the report with your feedback…",
    "clarify_intent":            "Need a bit more information…",
}

# When the generator loops (iteration ≥ 2), show a more specific label
_REVISE_LABEL = "Revising draft based on fact-check findings…"

# Nodes whose LLM streaming tokens should be forwarded to the UI.
# Portfolio Watch nodes call LLMs directly (not through nested sub-graphs),
# so all their events already have the correct langgraph_node metadata.
_STREAMABLE_NODES = {
    "gather_portfolio", "gather_signals", "generate_narrative", "evaluate_narrative",
    "conversational_responder", "refine_report",
}

# Nodes that use structured output (emit JSON tokens, not useful for UI).
_STRUCTURED_OUTPUT_NODES = {"conversation_router"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with portfolio_watch_lifespan(app):
        yield


app = FastAPI(
    title="Portfolio Watch Agent",
    description="Morgan — AI Portfolio Watch Officer. Generator-Evaluator pattern.",
    version="1.0.0",
    lifespan=lifespan,
)


class WatchRequest(BaseModel):
    prompt:     str = Field(default="Run a full portfolio watch scan", max_length=500)
    rm_id:      str = Field(default="rm001", max_length=64)
    session_id: str = Field(default="default", max_length=128)


class WatchResponse(BaseModel):
    markdown:   str
    meta:       dict
    session_id: str


@app.get("/health")
async def health():
    return {"status": "ok", "service": "portfolio-watch-agent"}


@app.post("/portfolio-watch")
async def watch_streaming(
    body: WatchRequest,
    request: Request,
    _: str = Security(verify_api_key),
):
    """
    Stream a Portfolio Watch Report via SSE.

    Event types emitted:
      progress — {"message": "…", "phase": "gather|generate|evaluate|format"}
      report   — {"markdown": "…", "meta": {…}}
      error    — {"message": "…"}
    """
    graph = request.app.state.graph
    log.info("watch_request", rm_id=body.rm_id, session_id=body.session_id)

    async def event_stream():
        # Track which generate_narrative pass we're on so we can show
        # "Revising…" on iteration ≥ 2 instead of the generic label.
        generate_call_count = 0

        try:
            async for event in graph.astream_events(
                {
                    "messages":  [HumanMessage(content=body.prompt)],
                    "rm_id":     body.rm_id,
                    "prompt":    body.prompt,
                    "session_id": body.session_id,
                    "clients":   [],
                    "signals":   {},
                    "iteration": 0,
                    "draft_narrative":    None,
                    "evaluation_verdict": None,
                    "evaluation_score":   None,
                    "evaluation_issues":  None,
                    "evaluation_missed":  None,
                    "final_report":  None,
                    "report_meta":   None,
                    "turn_type":     None,
                    "turn_count":    0,
                    "schema_version": 2,
                },
                config={
                    "configurable": {"thread_id": body.session_id},
                    "recursion_limit": _agent_config.recursion_limit,
                },
                version="v2",
            ):
                event_type = event.get("event", "")
                node_name  = event.get("metadata", {}).get("langgraph_node", "")

                if event_type == "on_chain_start" and node_name in _PROGRESS_LABELS:
                    if node_name == "generate_narrative":
                        generate_call_count += 1
                        label = _REVISE_LABEL if generate_call_count > 1 else _PROGRESS_LABELS[node_name]
                    else:
                        label = _PROGRESS_LABELS[node_name]

                    phase = _node_to_phase(node_name)
                    yield {
                        "event": "progress",
                        "data":  json.dumps({"message": label, "phase": phase}),
                    }

                # ── LLM streaming tokens (thinking / reasoning) ──────────────
                elif event_type == "on_chat_model_stream" and node_name in _STREAMABLE_NODES:
                    chunk = event.get("data", {}).get("chunk")
                    if chunk:
                        content = getattr(chunk, "content", "")
                        if isinstance(content, str) and content:
                            yield {
                                "event": "llm_token",
                                "data": json.dumps({
                                    "text": content,
                                    "node": node_name,
                                }),
                            }

                # ── Tool invocations (MCP calls) ─────────────────────────────
                elif event_type == "on_tool_start" and node_name in _STREAMABLE_NODES:
                    tool_name = event.get("name", "unknown_tool")
                    tool_input = event.get("data", {}).get("input", {})
                    input_str = json.dumps(tool_input) if isinstance(tool_input, dict) else str(tool_input)
                    if len(input_str) > 200:
                        input_str = input_str[:200] + "…"
                    yield {
                        "event": "tool_activity",
                        "data": json.dumps({
                            "action": "start",
                            "tool": tool_name,
                            "node": node_name,
                            "input_preview": input_str,
                        }),
                    }

                elif event_type == "on_tool_end" and node_name in _STREAMABLE_NODES:
                    tool_name = event.get("name", "unknown_tool")
                    output_str = str(event.get("data", {}).get("output", ""))
                    if len(output_str) > 300:
                        output_str = output_str[:300] + "…"
                    yield {
                        "event": "tool_activity",
                        "data": json.dumps({
                            "action": "end",
                            "tool": tool_name,
                            "node": node_name,
                            "output_preview": output_str,
                        }),
                    }

                elif event_type == "on_chain_end" and node_name == "evaluate_narrative":
                    # Guard: LangGraph also fires on_chain_end for the conditional edge
                    # function route_after_evaluation, which shares the same
                    # langgraph_node metadata ("evaluate_narrative") but returns a
                    # routing string, not a dict.  Skip non-dict outputs.
                    raw = event.get("data", {}).get("output")
                    if not isinstance(raw, dict):
                        continue

                    verdict = raw.get("evaluation_verdict", "pass")
                    score   = raw.get("evaluation_score") or 0.0
                    issues  = raw.get("evaluation_issues") or []
                    missed  = raw.get("evaluation_missed") or []

                    if verdict == "revise":
                        n_problems = len(issues) + len(missed)
                        message = (
                            f"Fact-check score: {score:.0%} — "
                            f"{n_problems} issue{'s' if n_problems != 1 else ''} found, revising draft"
                        )
                    else:
                        message = f"Fact-check passed — score {score:.0%}, report verified"

                    log.info("thinking_event", verdict=verdict, score=score, issues=len(issues))
                    yield {
                        "event": "thinking",
                        "data": json.dumps({
                            "message":        message,
                            "verdict":        verdict,
                            "score":          score,
                            "issues":         issues,
                            "missed_signals": missed,
                            "phase":          "evaluate",
                        }),
                    }

                elif event_type == "on_chain_end" and node_name == "format_report":
                    raw = event.get("data", {}).get("output")
                    if not isinstance(raw, dict):
                        continue
                    final_report = raw.get("final_report", "")
                    meta         = raw.get("report_meta", {})
                    log.info(
                        "watch_complete",
                        rm_id=body.rm_id,
                        session_id=body.session_id,
                        flags=meta.get("total_flags"),
                        score=meta.get("evaluation_score"),
                        iterations=meta.get("iterations"),
                    )
                    yield {
                        "event": "report",
                        "data":  json.dumps({"markdown": final_report, "meta": meta}),
                    }

                # ── Conversational responder output (follow-up answers) ────────
                elif event_type == "on_chain_end" and node_name == "conversational_responder":
                    raw = event.get("data", {}).get("output")
                    if isinstance(raw, dict):
                        answer = raw.get("final_report", "")
                        log.info("pw_follow_up_complete", session_id=body.session_id)
                        yield {
                            "event": "report",
                            "data": json.dumps({"markdown": answer, "meta": {}}),
                        }

                # ── Clarify intent output ──────────────────────────────────────
                elif event_type == "on_chain_end" and node_name == "clarify_intent":
                    raw = event.get("data", {}).get("output")
                    if isinstance(raw, dict):
                        msg = raw.get("final_report", "")
                        log.info("pw_clarification_sent", session_id=body.session_id)
                        yield {
                            "event": "report",
                            "data": json.dumps({"markdown": msg, "meta": {}}),
                        }

        except Exception as exc:
            log.error("watch_stream_error", error=str(exc), exc_info=True)
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(event_stream())


@app.post("/portfolio-watch/sync", response_model=WatchResponse)
async def watch_sync(
    body: WatchRequest,
    request: Request,
    _: str = Security(verify_api_key),
):
    """Synchronous report generation — for testing."""
    graph = request.app.state.graph
    try:
        result = await graph.ainvoke(
            {
                "messages":  [HumanMessage(content=body.prompt)],
                "rm_id":     body.rm_id,
                "prompt":    body.prompt,
                "session_id": body.session_id,
                "clients":   [],
                "signals":   {},
                "iteration": 0,
                "draft_narrative":    None,
                "evaluation_verdict": None,
                "evaluation_score":   None,
                "evaluation_issues":  None,
                "evaluation_missed":  None,
                "final_report":  None,
                "report_meta":   None,
                "turn_type":     None,
                "turn_count":    0,
                "schema_version": 2,
            },
            config={
                "configurable": {"thread_id": body.session_id},
                "recursion_limit": _agent_config.recursion_limit,
            },
        )
        return WatchResponse(
            markdown=result.get("final_report", ""),
            meta=result.get("report_meta", {}),
            session_id=body.session_id,
        )
    except Exception as exc:
        log.error("watch_sync_error", error=str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Helpers ────────────────────────────────────────────────────────────────────

def _node_to_phase(node_name: str) -> str:
    mapping = {
        "conversation_router":       "routing",
        "gather_portfolio":          "gather",
        "gather_signals":            "gather",
        "generate_narrative":        "generate",
        "evaluate_narrative":        "evaluate",
        "format_report":             "format",
        "conversational_responder":  "responding",
        "refine_report":             "refining",
        "clarify_intent":            "clarifying",
    }
    return mapping.get(node_name, "unknown")
