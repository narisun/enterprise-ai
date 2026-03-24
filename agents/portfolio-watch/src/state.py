"""
Portfolio Watch Agent — shared LangGraph state schema.

PortfolioWatchState flows through every node in the Generator-Evaluator graph.

Generator-Evaluator loop:
  generate_narrative writes draft_narrative and bumps iteration.
  evaluate_narrative writes evaluation_* fields.
  route_after_evaluation conditional edge decides: loop back or proceed.

Multi-turn support:
  conversation_router classifies each turn (new_task | follow_up | refinement | clarification)
  turn_type determines which graph branch executes
  turn_count tracks the number of turns in this session
"""
from typing import Annotated, Optional
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages

# Bump this when making breaking changes to PortfolioWatchState.
PORTFOLIO_WATCH_STATE_VERSION = 2


class PortfolioWatchState(TypedDict):
    # ── Conversation history ────────────────────────────────────────────────────
    messages: Annotated[list, add_messages]

    # ── Input ───────────────────────────────────────────────────────────────────
    rm_id: str
    prompt: str          # Optional focus area from the RM
    session_id: str

    # ── Multi-turn routing (set by conversation_router each turn) ────────────
    turn_type: Optional[str]      # new_task | follow_up | refinement | clarification
    turn_count: int               # Incremented each turn

    # ── Gathered data ───────────────────────────────────────────────────────────
    clients: list        # [{client_id, name, segment, industry, ...}]
    signals: dict        # keyed by client_id → {payments, news, credit}

    # ── Generator-Evaluator loop ────────────────────────────────────────────────
    draft_narrative: Optional[str]       # Raw markdown from Generator
    iteration: int                       # Starts at 0; incremented each generate pass

    # Evaluator output (overwritten each evaluation pass)
    evaluation_verdict: Optional[str]    # "pass" | "revise"
    evaluation_score: Optional[float]    # 0.0–1.0
    evaluation_issues: Optional[list]    # [{claim, problem, correction}]
    evaluation_missed: Optional[list]    # signals that should have been flagged

    # ── Final output ─────────────────────────────────────────────────────────────
    final_report: Optional[str]          # Verified markdown report
    report_meta: Optional[dict]          # {clients, flags, score, iterations}

    # ---- Schema versioning (for checkpoint migration safety) ----
    schema_version: int  # Current version: 2. Bump on breaking state changes.
