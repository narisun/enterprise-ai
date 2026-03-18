"""
Portfolio Watch — format_report node.

Takes the verified draft_narrative and appends a metadata footer:
  - evaluation score, number of iterations, data-as-of timestamp.

Also counts how many HIGH/MEDIUM risk flags were found for the meta dict.
"""
import re
from datetime import datetime

from platform_sdk import get_logger

log = get_logger(__name__)


def make_format_report_node():

    async def format_report(state: dict) -> dict:
        narrative  = state.get("draft_narrative", "")
        score      = state.get("evaluation_score")
        iteration  = state.get("iteration", 1)
        clients    = state.get("clients", [])
        verdict    = state.get("evaluation_verdict", "pass")
        issues     = state.get("evaluation_issues") or []
        rm_id      = state.get("rm_id", "RM")

        # Count risk flags by severity
        high_count   = len(re.findall(r"\*\*HIGH",   narrative, re.IGNORECASE))
        medium_count = len(re.findall(r"\*\*MEDIUM", narrative, re.IGNORECASE))
        total_flags  = high_count + medium_count

        as_of = datetime.now().strftime("%d %B %Y, %H:%M")

        # Append metadata footer
        score_display = f"{score:.0%}" if score is not None else "N/A"
        iter_display  = f"{iteration} pass{'es' if iteration != 1 else ''}"

        footer_lines = [
            "\n\n---",
            f"*Report prepared by Morgan · Portfolio Watch Officer*  ",
            f"*RM: {rm_id} · Data as of: {as_of}*  ",
            f"*Fact-check score: {score_display} · Generated in {iter_display}*",
        ]

        # If the evaluator accepted with residual issues (max iterations hit), note it
        if verdict == "revise" and iteration >= 2:
            footer_lines.append(
                "\n> ⚠️ **Note:** Some claims could not be fully verified in the available "
                "passes. Please cross-check flagged items before acting."
            )

        final_report = narrative + "\n".join(footer_lines)

        report_meta = {
            "clients": len(clients),
            "flags_high": high_count,
            "flags_medium": medium_count,
            "total_flags": total_flags,
            "evaluation_score": score,
            "iterations": iteration,
            "rm_id": rm_id,
            "as_of": as_of,
        }

        log.info(
            "report_formatted",
            rm_id=rm_id,
            clients=len(clients),
            flags=total_flags,
            score=score,
            iterations=iteration,
        )

        return {
            "final_report": final_report,
            "report_meta": report_meta,
        }

    return format_report
