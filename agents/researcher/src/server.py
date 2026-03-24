"""
FastAPI server for the Research Deep Agent.

Exposes a single POST /api/research endpoint that:
1. Accepts a research prompt + session_id
2. Runs the deep agent graph
3. Streams SSE events to the frontend:
   - plan_update: research plan created/updated
   - tool_start / tool_end: tool invocations
   - subagent_start / subagent_end: delegated subtasks
   - token: streaming text output
   - thinking: intermediate reasoning
   - artifact: structured output documents
   - done: final response
   - error: failure details
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Optional
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from .config import load_config, ResearcherConfig
from .graph import build_research_agent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class ResearchRequest(BaseModel):
    prompt: str
    session_id: str
    messages: list[dict] = []


class HealthResponse(BaseModel):
    status: str
    agent: str
    model: str

# ---------------------------------------------------------------------------
# SSE event helpers
# ---------------------------------------------------------------------------

def _sse(event: str, data: dict) -> dict:
    """Format an SSE event."""
    return {"event": event, "data": json.dumps(data)}

# ---------------------------------------------------------------------------
# Node-to-event mapping for the fallback agent
# ---------------------------------------------------------------------------

_NODE_LABELS = {
    "plan": "Creating research plan",
    "research": "Researching",
    "synthesize": "Synthesizing findings",
}

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Build the agent graph on startup."""
    config = load_config()
    checkpointer = MemorySaver()
    graph = build_research_agent(config, checkpointer=checkpointer)

    app.state.graph = graph
    app.state.config = config
    app.state.checkpointer = checkpointer

    logger.info(
        "Research agent ready (model=%s, port=%d)",
        config.model, config.port,
    )
    yield


app = FastAPI(title="Research Deep Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    config: ResearcherConfig = app.state.config
    return HealthResponse(
        status="ok",
        agent="researcher",
        model=config.model,
    )


@app.post("/api/research")
async def research_stream(body: ResearchRequest, request: Request):
    """Stream research execution via SSE."""
    graph = app.state.graph
    config = app.state.config

    async def event_stream():
        current_node = None
        plan_sent = False
        final_content = ""

        try:
            async for event in graph.astream_events(
                {
                    "messages": [HumanMessage(content=body.prompt)],
                    "plan": None,
                    "session_id": body.session_id,
                },
                config={
                    "configurable": {"thread_id": body.session_id},
                    "recursion_limit": config.recursion_limit,
                },
                version="v2",
            ):
                # Check if client disconnected
                if await request.is_disconnected():
                    logger.info("Client disconnected, stopping stream")
                    return

                event_type = event.get("event", "")
                event_name = event.get("name", "")
                event_data = event.get("data", {})

                # --- Node start: emit progress ---
                if event_type == "on_chain_start" and event_name in _NODE_LABELS:
                    current_node = event_name
                    label = _NODE_LABELS.get(event_name, event_name)
                    yield _sse("thinking", {"text": label + "..."})

                # --- Plan node completion: emit plan_update ---
                if event_type == "on_chain_end" and event_name == "plan":
                    output = event_data.get("output", {})
                    plan = output.get("plan") if isinstance(output, dict) else None
                    if plan:
                        yield _sse("plan_update", plan)
                        plan_sent = True
                        # Mark first step as in_progress
                        if plan.get("todos") and len(plan["todos"]) > 0:
                            plan["todos"][0]["status"] = "in_progress"
                            yield _sse("plan_update", plan)

                # --- Tool calls: emit tool_start/tool_end ---
                if event_type == "on_tool_start":
                    tool_id = str(uuid4())[:8]
                    yield _sse("tool_start", {
                        "id": tool_id,
                        "tool": event_name,
                        "args": _safe_serialize(
                            event_data.get("input", {})
                        ),
                    })
                    # Stash tool_id for matching end event
                    event["_tool_id"] = tool_id

                if event_type == "on_tool_end":
                    output = event_data.get("output", "")
                    yield _sse("tool_end", {
                        "id": event.get("_tool_id", str(uuid4())[:8]),
                        "tool": event_name,
                        "result": str(output)[:500],  # Truncate large results
                    })

                    # Update plan progress
                    if plan_sent:
                        yield _sse("thinking", {
                            "text": f"Completed: {event_name}",
                        })

                # --- LLM streaming tokens ---
                if event_type == "on_chat_model_stream":
                    chunk = event_data.get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        # Only stream tokens from the synthesize node
                        if current_node == "synthesize":
                            yield _sse("token", {"text": chunk.content})
                            final_content += chunk.content

                # --- Synthesis complete ---
                if event_type == "on_chain_end" and event_name == "synthesize":
                    output = event_data.get("output", {})
                    if isinstance(output, dict):
                        msgs = output.get("messages", [])
                        if msgs:
                            last_msg = msgs[-1]
                            content = (
                                last_msg.content
                                if hasattr(last_msg, "content")
                                else str(last_msg)
                            )
                            if content and not final_content:
                                final_content = content

                    # Mark all plan items as done
                    if plan_sent:
                        yield _sse("plan_update", {
                            "todos": [
                                {**t, "status": "done"}
                                for t in (plan or {}).get("todos", [])
                            ]
                        })

            # --- Stream complete ---
            yield _sse("done", {
                "content": final_content or None,
            })

        except Exception as e:
            logger.exception("Research agent error")
            yield _sse("error", {"message": str(e)})

    return EventSourceResponse(event_stream())


def _safe_serialize(obj) -> dict | str:
    """Safely serialize tool input for SSE."""
    if isinstance(obj, dict):
        return {k: str(v)[:200] for k, v in obj.items()}
    return str(obj)[:200]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    """Run the server."""
    import uvicorn

    config = load_config()
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(
        "src.server:app",
        host=config.host,
        port=config.port,
        reload=True,
    )


if __name__ == "__main__":
    main()
