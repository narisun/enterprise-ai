"""
Portfolio Watch Agent — multi-turn conversation nodes.

conversation_router:        Classifies each turn (new_task | follow_up | refinement | clarification)
conversational_responder:   Answers follow-up questions from portfolio data already in state
refine_report_node:         Re-generates the narrative incorporating RM feedback
clarify_intent:             Asks user for more information when request is ambiguous
"""
import json
from datetime import datetime
from typing import Literal, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from platform_sdk import configure_logging, get_logger
from ..state import PortfolioWatchState

configure_logging()
log = get_logger(__name__)


# ─── Structured output model ──────────────────────────────────────────────────

class _TurnClassification(BaseModel):
    turn_type: Literal["new_task", "follow_up", "refinement", "clarification"] = Field(
        description="Type of turn: new_task for fresh scan, follow_up for questions about existing data, "
                    "refinement for modifying the report, clarification for ambiguous messages."
    )


# ─── Router prompt ────────────────────────────────────────────────────────────

_ROUTER_SYSTEM = """You are a turn classifier for a Portfolio Watch AI assistant.

Classify the latest user message based on the conversation state:

CONVERSATION STATE:
- Report already generated: {has_report}
- Portfolio data gathered: {has_clients}
- Signals data gathered: {has_signals}
- Turn count: {turn_count}

CLASSIFICATION RULES:
1. **new_task**: User wants a fresh portfolio scan, or this is the first message (turn_count=0 with no data).
2. **follow_up**: User is asking about data already gathered — clients, signals, report contents. Data must exist.
3. **refinement**: User wants to MODIFY the existing report. Examples: "Focus more on risk", "Add details about payments". Report must exist.
4. **clarification**: Message is too ambiguous to proceed.

- If no data has been gathered yet, classify as new_task.
- Prefer follow_up over clarification when data exists.

Respond with your classification."""


def make_conversation_router_node(router_llm):
    """Entry point node that classifies each turn."""
    structured = router_llm.with_structured_output(_TurnClassification)

    async def conversation_router(state: PortfolioWatchState) -> dict:
        has_report = bool(state.get("final_report"))
        has_clients = bool(state.get("clients"))
        has_signals = bool(state.get("signals"))
        turn_count = state.get("turn_count", 0)

        system = _ROUTER_SYSTEM.format(
            has_report=has_report,
            has_clients=has_clients,
            has_signals=has_signals,
            turn_count=turn_count,
        )

        try:
            result = await structured.ainvoke(
                [SystemMessage(content=system)] + list(state["messages"])
            )
            log.info(
                "pw_turn_classified",
                turn_type=result.turn_type,
                turn_count=turn_count + 1,
            )
            return {
                "turn_type": result.turn_type,
                "turn_count": turn_count + 1,
            }
        except Exception as exc:
            log.error("pw_conversation_router_error", error=str(exc))
            if has_report or has_clients:
                return {"turn_type": "follow_up", "turn_count": turn_count + 1}
            return {"turn_type": "new_task", "turn_count": turn_count + 1}

    return conversation_router


def route_after_classification(state: PortfolioWatchState) -> str:
    """Conditional edge: dispatch based on turn_type."""
    turn_type = state.get("turn_type", "new_task")

    if turn_type == "follow_up":
        return "conversational_responder"
    elif turn_type == "refinement":
        return "refine_report"
    elif turn_type == "clarification":
        return "clarify_intent"
    else:
        return "gather_portfolio"


# ─── Conversational responder ─────────────────────────────────────────────────

_RESPONDER_SYSTEM = """You are Morgan, Portfolio Watch Officer at an enterprise commercial bank.

A portfolio report has already been prepared. The RM is asking a follow-up question. Answer using ONLY the data below.

{report_section}

PORTFOLIO DATA:
Clients: {clients_summary}

SIGNALS DATA:
{signals_summary}

RULES:
1. Answer ONLY from the data above. If the answer is not available, say so.
2. Be conversational and concise — this is a follow-up, not a full report.
3. NEVER invent data points. Use exact figures from the source data.
4. If the user asks about something not covered, suggest they request a fresh scan.
"""


def make_conversational_responder_node(responder_llm):
    """Answers follow-up questions from existing portfolio data."""

    async def conversational_responder(state: PortfolioWatchState) -> dict:
        # Build context summaries
        report_section = ""
        if state.get("final_report"):
            report_section = f"PREVIOUS REPORT:\n{state['final_report']}"

        clients = state.get("clients", [])
        clients_summary = json.dumps(clients, indent=2) if clients else "[No client data]"

        signals = state.get("signals", {})
        signals_summary = json.dumps(signals, indent=2) if signals else "[No signals data]"

        system = _RESPONDER_SYSTEM.format(
            report_section=report_section,
            clients_summary=clients_summary[:3000],  # Truncate for token limits
            signals_summary=signals_summary[:3000],
        )

        try:
            response = await responder_llm.ainvoke(
                [SystemMessage(content=system)] + list(state["messages"])
            )
            answer = response.content if hasattr(response, "content") else str(response)
            log.info("pw_follow_up_answered")

            return {
                "messages": [AIMessage(content=answer)],
                "final_report": answer,
            }
        except Exception as exc:
            log.error("pw_conversational_responder_error", error=str(exc))
            error_msg = (
                "I encountered an issue answering your question. "
                "Could you try rephrasing, or would you like me to run a fresh portfolio scan?"
            )
            return {
                "messages": [AIMessage(content=error_msg)],
                "final_report": error_msg,
            }

    return conversational_responder


# ─── Refine report ────────────────────────────────────────────────────────────

_REFINE_SYSTEM = """You are Morgan, Portfolio Watch Officer at an enterprise commercial bank.

A portfolio report was previously generated. The RM has requested specific changes. Regenerate the report incorporating their feedback.

PREVIOUS REPORT:
{previous_report}

RM FEEDBACK:
{feedback}

PORTFOLIO DATA:
{signals_summary}

RULES:
1. Apply the RM's feedback to improve the report.
2. Preserve all accurate information from the original.
3. NEVER invent data points. Use exact figures from source data.
4. Keep the structured format: Executive Summary, Risk Highlights, Client Assessments, Recommended Actions.
5. Every claim must be evidence-backed from the portfolio data.
"""


def make_refine_report_node(generator_llm):
    """Re-generates the narrative with RM feedback."""

    async def refine_report(state: PortfolioWatchState) -> dict:
        # Get the most recent user message (the refinement request)
        user_messages = [m for m in state["messages"] if isinstance(m, HumanMessage)]
        feedback = user_messages[-1].content if user_messages else "Improve the report."

        signals = state.get("signals", {})
        signals_summary = json.dumps(signals, indent=2) if signals else "[No signals data]"

        system = _REFINE_SYSTEM.format(
            previous_report=state.get("final_report") or "[No previous report]",
            feedback=feedback,
            signals_summary=signals_summary[:3000],
        )

        try:
            response = await generator_llm.ainvoke(
                [SystemMessage(content=system), HumanMessage(content="Produce the refined report now.")]
            )
            narrative = response.content if hasattr(response, "content") else str(response)
            log.info("pw_report_refined")

            return {
                "draft_narrative": narrative,
                "iteration": state.get("iteration", 0) + 1,
            }
        except Exception as exc:
            log.error("pw_refine_report_error", error=str(exc))
            return {
                "draft_narrative": state.get("draft_narrative", "Refinement failed."),
                "iteration": state.get("iteration", 0) + 1,
            }

    return refine_report


# ─── Clarify intent ───────────────────────────────────────────────────────────

def make_clarify_intent_node():
    """Asks user for more information."""

    async def clarify_intent(state: PortfolioWatchState) -> dict:
        log.info("pw_clarification_requested")
        msg = (
            "I'm not sure what you'd like me to do. I can:\n"
            "- Run a fresh portfolio scan\n"
            "- Answer questions about an existing report\n"
            "- Refine a previous report with your feedback\n\n"
            "What would you prefer?"
        )
        return {
            "messages": [AIMessage(content=msg)],
            "final_report": msg,
        }

    return clarify_intent
