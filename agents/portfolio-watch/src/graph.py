"""
Portfolio Watch Agent — LangGraph StateGraph (Generator-Evaluator with multi-turn).

Pipeline (new_task):
  conversation_router → gather_portfolio → gather_signals
       ↓
  generate_narrative   ←──────────────────────┐
       ↓                                       │  (revise + iteration < max)
  evaluate_narrative                           │
       ↓                                       │
  route_after_evaluation ── revise? ───────────┘
       │
       └── pass (or max iterations) ──▶ format_report ──▶ END

Multi-turn branches:
  conversation_router → conversational_responder   (follow_up → END)
  conversation_router → refine_report → evaluate_narrative → ... (refinement)
  conversation_router → clarify_intent                      (clarification → END)

Model tiering:
  conversation_router:  fast-routing  (Haiku — structured classification)
  Generator:            complex-routing (Sonnet — coherent, structured writing)
  Evaluator:            complex-routing (Sonnet — careful fact-checking reasoning)
"""
from contextlib import asynccontextmanager

from langgraph.graph import END, StateGraph

from platform_sdk import AgentConfig, configure_logging, get_logger, make_chat_llm, make_checkpointer
from .state import PortfolioWatchState
from .nodes.gather import make_gather_portfolio_node, make_gather_signals_node
from .nodes.generator import make_generate_narrative_node
from .nodes.evaluator import make_evaluate_narrative_node, route_after_evaluation
from .nodes.formatter import make_format_report_node
from .nodes.conversation import (
    make_conversation_router_node,
    make_conversational_responder_node,
    make_refine_report_node,
    make_clarify_intent_node,
    route_after_classification,
)

configure_logging()
log = get_logger(__name__)


def build_portfolio_watch_graph(generator_llm, evaluator_llm, router_llm, config=None) -> object:
    """Assemble and compile the Portfolio Watch StateGraph with multi-turn support."""

    builder = StateGraph(PortfolioWatchState)

    # ── Register nodes ─────────────────────────────────────────────────────────
    # Multi-turn entry point
    builder.add_node("conversation_router",       make_conversation_router_node(router_llm))
    builder.add_node("conversational_responder",  make_conversational_responder_node(generator_llm))
    builder.add_node("refine_report",             make_refine_report_node(generator_llm))
    builder.add_node("clarify_intent",            make_clarify_intent_node())

    # Existing pipeline nodes
    builder.add_node("gather_portfolio",   make_gather_portfolio_node())
    builder.add_node("gather_signals",     make_gather_signals_node())
    builder.add_node("generate_narrative", make_generate_narrative_node(generator_llm))
    builder.add_node("evaluate_narrative", make_evaluate_narrative_node(evaluator_llm))
    builder.add_node("format_report",      make_format_report_node())

    # ── Entry point ────────────────────────────────────────────────────────────
    builder.set_entry_point("conversation_router")

    # ── Conditional routing from conversation_router ───────────────────────────
    builder.add_conditional_edges(
        "conversation_router",
        route_after_classification,
        {
            "gather_portfolio":         "gather_portfolio",          # new_task → full pipeline
            "conversational_responder": "conversational_responder",  # follow_up
            "refine_report":            "refine_report",             # refinement
            "clarify_intent":           "clarify_intent",            # clarification
        }
    )

    # ── Multi-turn terminal edges ──────────────────────────────────────────────
    builder.add_edge("conversational_responder", END)
    builder.add_edge("clarify_intent", END)
    # Refinement re-enters the evaluate loop (so fact-checking still happens)
    builder.add_edge("refine_report", "evaluate_narrative")

    # ── Existing pipeline edges ────────────────────────────────────────────────
    builder.add_edge("gather_portfolio",   "gather_signals")
    builder.add_edge("gather_signals",     "generate_narrative")
    builder.add_edge("generate_narrative", "evaluate_narrative")

    # ── Conditional edge: the Generator-Evaluator loop ─────────────────────────
    builder.add_conditional_edges(
        "evaluate_narrative",
        route_after_evaluation,
        {
            "generate_narrative": "generate_narrative",   # loop back
            "format_report":      "format_report",        # proceed
        },
    )

    builder.add_edge("format_report", END)

    checkpointer = make_checkpointer(config)
    return builder.compile(checkpointer=checkpointer)


# ── Lifespan context manager ───────────────────────────────────────────────────

@asynccontextmanager
async def portfolio_watch_lifespan(app):
    """Build LLMs and compile the graph on startup."""
    config = AgentConfig.from_env()

    # Generator and Evaluator both use the complex model — they need careful
    # reasoning rather than raw speed.
    generator_llm = make_chat_llm(config.synthesis_model_route)
    evaluator_llm = make_chat_llm(config.synthesis_model_route)

    # Router uses the fast model for classification
    router_llm = make_chat_llm(config.router_model_route)

    app.state.graph  = build_portfolio_watch_graph(generator_llm, evaluator_llm, router_llm, config=config)
    app.state.config = config

    log.info("portfolio_watch_graph_ready")
    yield
    log.info("portfolio_watch_graph_shutdown")
