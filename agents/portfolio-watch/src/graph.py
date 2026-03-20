"""
Portfolio Watch Agent — LangGraph StateGraph (Generator-Evaluator pattern).

Pipeline:
  gather_portfolio
       ↓
  gather_signals
       ↓
  generate_narrative   ←──────────────────────┐
       ↓                                       │  (revise + iteration < max)
  evaluate_narrative                           │
       ↓                                       │
  route_after_evaluation ── revise? ───────────┘
       │
       └── pass (or max iterations) ──▶ format_report ──▶ END

Model tiering:
  Generator:  complex-routing (Sonnet — coherent, structured writing)
  Evaluator:  complex-routing (Sonnet — careful fact-checking reasoning)
"""
from contextlib import asynccontextmanager

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from platform_sdk import AgentConfig, configure_logging, get_logger, make_chat_llm
from .state import PortfolioWatchState
from .nodes.gather import make_gather_portfolio_node, make_gather_signals_node
from .nodes.generator import make_generate_narrative_node
from .nodes.evaluator import make_evaluate_narrative_node, route_after_evaluation
from .nodes.formatter import make_format_report_node

configure_logging()
log = get_logger(__name__)


def build_portfolio_watch_graph(generator_llm, evaluator_llm) -> object:
    """Assemble and compile the Portfolio Watch StateGraph."""

    builder = StateGraph(PortfolioWatchState)

    # ── Register nodes ─────────────────────────────────────────────────────────
    builder.add_node("gather_portfolio",   make_gather_portfolio_node())
    builder.add_node("gather_signals",     make_gather_signals_node())
    builder.add_node("generate_narrative", make_generate_narrative_node(generator_llm))
    builder.add_node("evaluate_narrative", make_evaluate_narrative_node(evaluator_llm))
    builder.add_node("format_report",      make_format_report_node())

    # ── Entry point ────────────────────────────────────────────────────────────
    builder.set_entry_point("gather_portfolio")

    # ── Static edges ───────────────────────────────────────────────────────────
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

    checkpointer = MemorySaver()
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

    app.state.graph  = build_portfolio_watch_graph(generator_llm, evaluator_llm)
    app.state.config = config

    log.info("portfolio_watch_graph_ready")
    yield
    log.info("portfolio_watch_graph_shutdown")
