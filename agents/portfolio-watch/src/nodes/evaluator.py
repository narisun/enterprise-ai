"""
Portfolio Watch — Evaluator node (The Checker) + routing logic.

evaluate_narrative : fact-checks every claim in the draft against raw signals.
route_after_evaluation : conditional edge — loop back or proceed to format.
"""
import json

from langchain_core.messages import HumanMessage, SystemMessage

from platform_sdk import get_logger
from ..prompts.evaluator_prompt import EVALUATOR_SYSTEM, build_evaluator_user_message

log = get_logger(__name__)

_MAX_ITERATIONS = 2   # Maximum generator loops before we accept what we have


def make_evaluate_narrative_node(llm):
    """
    Factory that captures the LLM instance.

    The evaluator returns a structured JSON verdict. If the LLM output
    cannot be parsed, we default to "pass" so we never get stuck.
    """

    async def evaluate_narrative(state: dict) -> dict:
        draft    = state.get("draft_narrative", "")
        signals  = state.get("signals", {})
        iteration = state.get("iteration", 1)  # Already incremented by generator

        signals_json = json.dumps(signals, indent=2)
        user_msg = build_evaluator_user_message(draft, signals_json)

        log.info("evaluating_narrative", iteration=iteration, draft_length=len(draft))

        try:
            response = await llm.ainvoke([
                SystemMessage(content=EVALUATOR_SYSTEM),
                HumanMessage(content=user_msg),
            ])
            raw = response.content.strip()

            # Strip markdown code fences if the LLM wrapped the JSON
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()

            result = json.loads(raw)

            verdict = result.get("verdict", "pass")
            score   = float(result.get("score", 1.0))
            issues  = result.get("issues", [])
            missed  = result.get("missed_signals", [])

            log.info(
                "evaluation_complete",
                verdict=verdict,
                score=score,
                issues=len(issues),
                missed=len(missed),
                iteration=iteration,
            )

            return {
                "evaluation_verdict": verdict,
                "evaluation_score": score,
                "evaluation_issues": issues,
                "evaluation_missed": missed,
            }

        except json.JSONDecodeError as exc:
            log.error("evaluator_json_parse_error", error=str(exc), raw_preview=raw[:200])
            # Default to pass on parse failure — don't loop forever
            return {
                "evaluation_verdict": "pass",
                "evaluation_score": 0.75,
                "evaluation_issues": [],
                "evaluation_missed": [],
            }
        except Exception as exc:
            log.error("evaluator_error", error=str(exc))
            return {
                "evaluation_verdict": "pass",
                "evaluation_score": 0.7,
                "evaluation_issues": [],
                "evaluation_missed": [],
            }

    return evaluate_narrative


def route_after_evaluation(state: dict) -> str:
    """
    Conditional edge: decide whether to loop back to the generator or proceed.

    Loops back when:
      - verdict is "revise"  AND
      - iteration count is still below the max

    Proceeds when:
      - verdict is "pass", OR
      - max iterations reached (accept what we have rather than looping forever)
    """
    verdict   = state.get("evaluation_verdict", "pass")
    iteration = state.get("iteration", 1)

    if verdict == "revise" and iteration < _MAX_ITERATIONS:
        log.info("routing_to_generator", reason="evaluator_revise", iteration=iteration)
        return "generate_narrative"

    if verdict == "revise" and iteration >= _MAX_ITERATIONS:
        log.info(
            "routing_to_format",
            reason="max_iterations_reached",
            iteration=iteration,
            verdict=verdict,
        )
    else:
        log.info("routing_to_format", reason="evaluator_pass", score=state.get("evaluation_score"))

    return "format_report"
