"""
RM Prep Orchestrator — LangGraph StateGraph with multi-turn conversation support.

Pipeline (new_task):
  conversation_router → route → gather_crm
                                    ├─(parallel)─ gather_payments ─┐
                                    └─(parallel)─ gather_news      ─┤
                                                                    └─ synthesize → format_brief

Multi-turn branches:
  conversation_router → conversational_responder   (follow_up)
  conversation_router → refine_brief → format_brief (refinement)
  conversation_router → clarify_intent              (clarification)

Model tiering:
  conversation_router:        fast-routing  (Haiku — structured classification)
  route:                      no LLM        (pure Python dict lookup)
  gather_crm:                 fast-routing  (Haiku — tool call + JSON passthrough)
  gather_payments:            fast-routing  (Haiku — tool call + JSON passthrough)
  gather_news:                fast-routing  (Haiku — tool call + JSON passthrough)
  synthesize:                 complex-routing (Sonnet — coherent brief writing)
  conversational_responder:   complex-routing (Sonnet — contextual answers)
  refine_brief:               complex-routing (Sonnet — brief modification)
  format_brief:               no LLM        (Jinja2 template render)
"""
from pathlib import Path
from typing import Optional

from langgraph.graph import END, StateGraph

from platform_sdk import AgentConfig, configure_logging, get_logger, make_chat_llm, make_checkpointer
from platform_sdk.prompts import PromptLoader
from .state import RMPrepState
from .nodes.router import (
    _make_conversation_router_node,
    _route_after_classification,
    _make_clarify_intent_node,
)
from .nodes.gather import (
    _make_route_node,
    _make_gather_crm_node,
    _make_gather_payments_node,
    _make_gather_news_node,
)
from .nodes.synthesis import (
    _make_synthesize_node,
    _make_conversational_responder_node,
    _make_refine_brief_node,
    _make_format_brief_node,
)

configure_logging()
log = get_logger(__name__)

_PROMPT_DIR = Path(__file__).parent / "prompts"
# Default PromptLoader using SandboxedEnvironment — prevents SSTI attacks.
# This module-level instance is used by the lifespan path; tests can inject
# their own PromptLoader via build_rm_orchestrator(prompts=...).
_default_prompts = PromptLoader.from_directory(_PROMPT_DIR)


# ─── Orchestrator builder ──────────────────────────────────────────────────────

def build_rm_orchestrator(
    crm_agent,
    pay_agent,
    news_agent,
    synthesis_llm,
    config: AgentConfig,
    prompts: Optional[PromptLoader] = None,
):
    """Build the RM Prep StateGraph orchestrator with multi-turn conversation support.

    Args:
        prompts: Injectable PromptLoader. Defaults to the module-level sandboxed
                 loader. Tests can inject a PromptLoader pointing at fixture templates.
    """
    if prompts is None:
        prompts = _default_prompts

    router_llm = make_chat_llm(config.router_model_route)

    builder = StateGraph(RMPrepState)

    # ── Register all nodes ─────────────────────────────────────────────────────
    # Entry point: classifies turn type
    builder.add_node("conversation_router",       _make_conversation_router_node(router_llm, prompts))
    # Multi-turn branches
    builder.add_node("conversational_responder",  _make_conversational_responder_node(synthesis_llm, prompts))
    builder.add_node("refine_brief",              _make_refine_brief_node(synthesis_llm, prompts))
    builder.add_node("clarify_intent",            _make_clarify_intent_node())
    # Existing pipeline nodes
    builder.add_node("route",                     _make_route_node())
    builder.add_node("gather_crm",                _make_gather_crm_node(crm_agent))
    builder.add_node("gather_payments",           _make_gather_payments_node(pay_agent))
    builder.add_node("gather_news",               _make_gather_news_node(news_agent))
    builder.add_node("synthesize",                _make_synthesize_node(synthesis_llm, "rm_prep_synthesis.j2", prompts))
    builder.add_node("format_brief",              _make_format_brief_node())

    # ── Entry point ────────────────────────────────────────────────────────────
    builder.set_entry_point("conversation_router")

    # ── Conditional routing from conversation_router ────────────────────────────
    builder.add_conditional_edges(
        "conversation_router",
        _route_after_classification,
        {
            "route":                      "route",                      # new_task → full pipeline
            "conversational_responder":   "conversational_responder",   # follow_up
            "refine_brief":               "refine_brief",               # refinement
            "clarify_intent":             "clarify_intent",             # clarification
        }
    )

    # ── Multi-turn terminal edges ──────────────────────────────────────────────
    builder.add_edge("conversational_responder", END)
    builder.add_edge("clarify_intent", END)
    builder.add_edge("refine_brief", "format_brief")  # refinement re-uses format_brief

    # ── Existing pipeline edges (unchanged) ────────────────────────────────────
    builder.add_edge("route", "gather_crm")

    builder.add_edge("gather_crm", "gather_payments")
    builder.add_edge("gather_crm", "gather_news")

    builder.add_edge("gather_payments", "synthesize")
    builder.add_edge("gather_news", "synthesize")

    builder.add_edge("synthesize", "format_brief")
    builder.add_edge("format_brief", END)

    checkpointer = make_checkpointer(config)
    return builder.compile(checkpointer=checkpointer)
