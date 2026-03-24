"""Brief synthesis and refinement nodes."""
from datetime import datetime, timezone

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from platform_sdk import get_logger
from platform_sdk.prompts import PromptLoader
from ..brief import RMBrief, render_brief
from ..state import RMPrepState

log = get_logger(__name__)


def _make_synthesize_node(synthesis_llm, synthesis_template: str, prompts: PromptLoader):
    """Synthesize CRM, payments, and news data into a structured brief."""
    structured = synthesis_llm.with_structured_output(RMBrief)

    async def synthesize(state: RMPrepState) -> dict:
        prompt = prompts.render(
            synthesis_template,
            today=datetime.now(timezone.utc).strftime("%B %d, %Y"),
            rm_name=state.get("rm_id", "Relationship Manager"),
            crm_data=state.get("crm_output") or "[CRM data unavailable]",
            payments_data=state.get("payments_output") or "[Payments data unavailable]",
            news_data=state.get("news_output") or "[News search unavailable]",
        )
        try:
            brief = await structured.ainvoke([HumanMessage(content=prompt)])
            log.info("brief_synthesized", client=state.get("client_name"))
            return {"brief_data": brief.model_dump()}
        except Exception as exc:
            log.error("synthesis_error", error=str(exc))
            # Fallback: return a minimal brief with the raw data
            fallback = RMBrief(
                client_name=state.get("client_name", "Unknown"),
                meeting_date=state.get("meeting_date"),
                executive_summary=f"Brief generation encountered an error: {exc}. Raw data is available in the source fields.",
                recent_activity=state.get("crm_output") or "[Unavailable]",
                payment_activity=state.get("payments_output") or "[Unavailable]",
                latest_news=state.get("news_output") or "[Unavailable]",
                talking_points=["Review the raw data above with your team"],
                suggested_questions=["What are your current priorities?"],
                watch_items="Brief generation failed — review raw data",
                sources=["[CRM]", "[Payments]", "[News]"],
            )
            return {"brief_data": fallback.model_dump(), "error_states": {"synthesis": str(exc)}}
    return synthesize


def _make_conversational_responder_node(synthesis_llm, prompts: PromptLoader):
    """Answers follow-up questions using data already in state."""

    async def conversational_responder(state: RMPrepState) -> dict:
        prompt = prompts.render(
            "conversational_responder.j2",
            today=datetime.now(timezone.utc).strftime("%B %d, %Y"),
            rm_name=state.get("rm_id", "Relationship Manager"),
            client_name=state.get("client_name", "Unknown"),
            brief_markdown=state.get("brief_markdown"),
            crm_data=state.get("crm_output") or "[CRM data not yet gathered]",
            payments_data=state.get("payments_output") or "[Payments data not yet gathered]",
            news_data=state.get("news_output") or "[News data not yet gathered]",
        )

        try:
            response = await synthesis_llm.ainvoke(
                [SystemMessage(content=prompt)] + list(state["messages"])
            )
            answer = response.content if hasattr(response, "content") else str(response)
            log.info("follow_up_answered", client=state.get("client_name"))

            return {
                "messages": [AIMessage(content=answer)],
                "brief_markdown": answer,
            }
        except Exception as exc:
            log.error("conversational_responder_error", error=str(exc))
            error_msg = (
                "I encountered an issue answering your question. "
                "Could you try rephrasing, or would you like me to generate a fresh brief?"
            )
            return {
                "messages": [AIMessage(content=error_msg)],
                "brief_markdown": error_msg,
                "error_states": {"conversational_responder": str(exc)},
            }

    return conversational_responder


def _make_refine_brief_node(synthesis_llm, prompts: PromptLoader):
    """Re-synthesizes the brief incorporating the RM's feedback."""
    structured = synthesis_llm.with_structured_output(RMBrief)

    async def refine_brief(state: RMPrepState) -> dict:
        # Get the most recent user message (the refinement request)
        user_messages = [m for m in state["messages"] if hasattr(m, "type") and m.type == "human"]
        if not user_messages:
            # Fallback: check for HumanMessage instances
            user_messages = [m for m in state["messages"] if isinstance(m, HumanMessage)]
        feedback = user_messages[-1].content if user_messages else "Improve the brief."

        prompt = prompts.render(
            "refine_synthesis.j2",
            today=datetime.now(timezone.utc).strftime("%B %d, %Y"),
            rm_name=state.get("rm_id", "Relationship Manager"),
            previous_brief=state.get("brief_markdown") or "[No previous brief]",
            feedback=feedback,
            crm_data=state.get("crm_output") or "[CRM data unavailable]",
            payments_data=state.get("payments_output") or "[Payments data unavailable]",
            news_data=state.get("news_output") or "[News search unavailable]",
        )

        try:
            brief = await structured.ainvoke([HumanMessage(content=prompt)])
            log.info("brief_refined", client=state.get("client_name"))
            return {"brief_data": brief.model_dump()}
        except Exception as exc:
            log.error("refine_brief_error", error=str(exc))
            fallback = RMBrief(
                client_name=state.get("client_name", "Unknown"),
                meeting_date=state.get("meeting_date"),
                executive_summary=f"Brief refinement encountered an error: {exc}. The original brief is preserved.",
                recent_activity=state.get("crm_output") or "[Unavailable]",
                payment_activity=state.get("payments_output") or "[Unavailable]",
                latest_news=state.get("news_output") or "[Unavailable]",
                talking_points=["Review the original brief and provide more specific feedback"],
                suggested_questions=["What specific changes would you like?"],
                watch_items="Brief refinement failed — original brief preserved",
                sources=["[CRM]", "[Payments]", "[News]"],
            )
            return {"brief_data": fallback.model_dump(), "error_states": {"refine_brief": str(exc)}}

    return refine_brief


def _make_format_brief_node():
    """Format structured brief data as markdown."""
    async def format_brief(state: RMPrepState) -> dict:
        brief_data = state.get("brief_data")
        if not brief_data:
            return {"brief_markdown": "Brief generation failed. Please try again."}
        brief = RMBrief(**brief_data)
        markdown = render_brief(brief, prepared_by=state.get("rm_id", "RM Prep Agent"))
        return {"brief_markdown": markdown}
    return format_brief
