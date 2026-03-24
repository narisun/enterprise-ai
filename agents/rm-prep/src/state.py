"""
RM Prep Agent — shared LangGraph state schema.

RMPrepState flows through every node in the orchestrator StateGraph.
Each node reads from it and writes only its own output field(s).

Parallel nodes (gather_payments and gather_news run simultaneously):
- payments_output and news_output are separate fields → no reducer needed
- error_states uses _merge_errors to combine updates from both nodes safely

Multi-turn support:
- conversation_router classifies each turn (new_task | follow_up | refinement | clarification)
- turn_type determines which graph branch executes
- turn_count tracks the number of turns in this session for compaction decisions
"""
from typing import Annotated, Optional
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages

# Bump this when making breaking changes to RMPrepState.
# The migration layer uses this to detect and upgrade old checkpoints.
RM_PREP_STATE_VERSION = 2


def _merge_errors(left: dict, right: dict) -> dict:
    """Merge error dicts from parallel nodes — last write wins per key."""
    merged = dict(left or {})
    merged.update(right or {})
    return merged


class RMPrepState(TypedDict):
    # ---- Conversation history (append-only; supports multi-turn follow-ups) ----
    messages: Annotated[list, add_messages]

    # ---- Identity (set by conversation_router, read by all subsequent nodes) ----
    rm_id: str
    client_name: str              # user-supplied name (may be partial, e.g. "Microsoft")
    account_name: Optional[str]   # canonical name from CRM (e.g. "Microsoft Corp.") — exact match key for bankdw
    account_id: Optional[str]     # populated by gather_crm; required by gather_payments
    meeting_date: Optional[str]
    intent_type: str              # full_brief | quick_update | news_check | payment_check
    agents_to_invoke: list        # ["crm", "payments", "news"]

    # ---- Multi-turn routing (set by conversation_router each turn) ----
    turn_type: Optional[str]      # new_task | follow_up | refinement | clarification
    turn_count: int               # Incremented each turn (for compaction decisions)

    # ---- Specialist outputs (each node writes its own field) ----
    crm_output: Optional[str]      # JSON string from get_salesforce_summary
    payments_output: Optional[str] # JSON string from get_payment_summary
    news_output: Optional[str]     # JSON string from search_company_news

    # ---- Synthesis ----
    brief_data: Optional[dict]    # Structured dict matching RMBrief fields
    brief_markdown: Optional[str] # Final rendered markdown sent to the RM

    # ---- Error tracking (merged across parallel nodes) ----
    error_states: Annotated[dict, _merge_errors]

    # ---- Session (maps to LangGraph thread_id for checkpointing) ----
    session_id: str

    # ---- Schema versioning (for checkpoint migration safety) ----
    schema_version: int  # Current version: 2. Bump on breaking state changes.
