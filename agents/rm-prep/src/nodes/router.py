"""Conversation routing and turn classification nodes."""
from datetime import datetime, timezone
from typing import Literal, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from platform_sdk import get_logger
from platform_sdk.prompts import PromptLoader
from ..state import RMPrepState

log = get_logger(__name__)


# ─── Structured output models ────────────────────────────────────────────────

class _TurnClassification(BaseModel):
    """Structured output for the conversation router."""
    turn_type: Literal["new_task", "follow_up", "refinement", "clarification"] = Field(
        description="Type of turn: new_task for fresh requests, follow_up for questions about existing data, "
                    "refinement for modifying the brief, clarification for ambiguous messages."
    )
    # Only populated for new_task turns:
    client_name: Optional[str] = Field(
        default=None,
        description="Company/client name extracted from the message. Required for new_task, null for other turn types."
    )
    intent_type: Optional[str] = Field(
        default=None,
        description="One of: full_brief, quick_update, news_check, payment_check. Required for new_task, null for other turn types."
    )
    meeting_date: Optional[str] = Field(
        default=None,
        description="Meeting date if explicitly mentioned, null otherwise."
    )


class _IntentResult(BaseModel):
    """Legacy structured output — kept for backward compatibility."""
    client_name: str
    intent_type: str
    meeting_date: Optional[str] = None


# ─── Node factories ─────────────────────────────────────────────────────────

def _make_conversation_router_node(router_llm, prompts: PromptLoader):
    """Entry point node that classifies each turn and routes accordingly."""
    structured = router_llm.with_structured_output(_TurnClassification)

    async def conversation_router(state: RMPrepState) -> dict:
        # Build context for the router prompt
        has_brief = bool(state.get("brief_markdown"))
        has_crm = bool(state.get("crm_output"))
        has_payments = bool(state.get("payments_output"))
        has_news = bool(state.get("news_output"))
        turn_count = state.get("turn_count", 0)

        system_prompt = prompts.render(
            "conversation_router.j2",
            client_name=state.get("client_name"),
            has_brief=has_brief,
            has_crm=has_crm,
            has_payments=has_payments,
            has_news=has_news,
            turn_count=turn_count,
        )

        try:
            result = await structured.ainvoke(
                [SystemMessage(content=system_prompt)] + list(state["messages"])
            )
            log.info(
                "turn_classified",
                turn_type=result.turn_type,
                client=result.client_name,
                intent=result.intent_type,
                turn_count=turn_count + 1,
            )

            update = {
                "turn_type": result.turn_type,
                "turn_count": turn_count + 1,
                "error_states": {},
            }

            # For new_task, populate identity fields like the old parse_intent did
            if result.turn_type == "new_task":
                if result.client_name:
                    update["client_name"] = result.client_name
                update["intent_type"] = result.intent_type or "full_brief"
                update["meeting_date"] = result.meeting_date

            return update

        except Exception as exc:
            log.error("conversation_router_error", error=str(exc))
            # If we have existing data, treat as follow_up (safer than re-running pipeline)
            if has_brief or has_crm:
                return {
                    "turn_type": "follow_up",
                    "turn_count": turn_count + 1,
                    "error_states": {"conversation_router": str(exc)},
                }
            # No existing data — ask for clarification
            return {
                "turn_type": "clarification",
                "turn_count": turn_count + 1,
                "client_name": "Clarification Required",
                "error_states": {"conversation_router": str(exc)},
            }

    return conversation_router


def _route_after_classification(state: RMPrepState) -> str:
    """Conditional edge: dispatch based on turn_type set by conversation_router."""
    turn_type = state.get("turn_type", "new_task")

    if turn_type == "follow_up":
        return "conversational_responder"
    elif turn_type == "refinement":
        return "refine_brief"
    elif turn_type == "clarification":
        return "clarify_intent"
    else:
        # new_task — run the full pipeline
        return "route"


def _make_clarify_intent_node():
    """Node that short-circuits the graph to ask the user for missing parameters."""
    async def clarify_intent(state: RMPrepState) -> dict:
        log.info("clarification_requested", reason="Missing client name or intent")

        # We skip synthesis and write directly to the final markdown output field
        clarification_msg = (
            "I couldn't clearly identify the client or company name in your request. "
            "Could you please specify which company you'd like me to look up?"
        )

        return {
            "messages": [AIMessage(content=clarification_msg)],
            "brief_markdown": clarification_msg,
        }
    return clarify_intent
