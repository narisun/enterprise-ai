"""
Portfolio Watch Agent — Type-safe enums for graph node names.
"""
from enum import Enum


class NodeName(str, Enum):
    """Node names in the Portfolio Watch StateGraph."""
    GATHER_PORTFOLIO = "gather_portfolio"
    GATHER_SIGNALS = "gather_signals"
    GENERATE_NARRATIVE = "generate_narrative"
    EVALUATE_NARRATIVE = "evaluate_narrative"
    FORMAT_REPORT = "format_report"


class EvaluationVerdict(str, Enum):
    """Possible verdicts from the evaluator node."""
    PASS = "pass"
    REVISE = "revise"
