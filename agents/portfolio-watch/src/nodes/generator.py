"""
Portfolio Watch — Generator node (The Maker).

Writes a portfolio narrative based on the gathered signals.
On subsequent iterations, receives evaluator feedback and addresses it.
"""
import json

from langchain_core.messages import HumanMessage, SystemMessage

from platform_sdk import get_logger
from ..prompts.generator_prompt import GENERATOR_SYSTEM, build_generator_user_message

log = get_logger(__name__)


def make_generate_narrative_node(llm):
    """
    Factory that captures the LLM instance.

    The node reads evaluation_issues from state (if any) and injects them
    into the generator prompt as corrective feedback on iteration >= 1.
    """

    async def generate_narrative(state: dict) -> dict:
        iteration = state.get("iteration", 0)
        clients   = state.get("clients", [])
        signals   = state.get("signals", {})
        rm_id     = state.get("rm_id", "RM")
        focus     = state.get("prompt", "")

        # Build evaluator feedback string (empty on first pass)
        evaluator_feedback = ""
        if iteration > 0:
            issues  = state.get("evaluation_issues") or []
            missed  = state.get("evaluation_missed") or []
            parts   = []
            for iss in issues:
                parts.append(
                    f"- {iss.get('client','?')}: Claim \"{iss.get('claim','')}\" "
                    f"is {iss.get('problem','')}. Correction: {iss.get('correction','')}"
                )
            for m in missed:
                parts.append(f"- MISSED SIGNAL: {m}")
            evaluator_feedback = "\n".join(parts)

        signals_json = json.dumps(signals, indent=2)
        user_msg = build_generator_user_message(
            rm_id=rm_id,
            client_count=len(clients),
            signals_json=signals_json,
            focus=focus,
            evaluator_feedback=evaluator_feedback,
        )

        log.info("generating_narrative", iteration=iteration, rm_id=rm_id, clients=len(clients))

        try:
            response = await llm.ainvoke([
                SystemMessage(content=GENERATOR_SYSTEM),
                HumanMessage(content=user_msg),
            ])
            narrative = response.content
            log.info("narrative_generated", iteration=iteration, length=len(narrative))
            return {
                "draft_narrative": narrative,
                "iteration": iteration + 1,
            }
        except Exception as exc:
            log.error("generator_error", iteration=iteration, error=str(exc))
            # Return a minimal narrative on failure so the evaluator can still run
            return {
                "draft_narrative": f"## Portfolio Watch Report\n\nGeneration failed: {exc}",
                "iteration": iteration + 1,
            }

    return generate_narrative
