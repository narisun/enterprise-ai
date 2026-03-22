"""
RM Prep Agent — Type-safe enums for graph node names and intent types.

Replaces magic strings in graph edge definitions and routing maps with
typed enums. Typos in edge definitions or routing keys are now caught
at development time (by the type system and IDE) rather than at runtime.
"""
from enum import Enum


class NodeName(str, Enum):
    """Node names in the RM Prep StateGraph."""
    PARSE_INTENT = "parse_intent"
    CLARIFY_INTENT = "clarify_intent"
    ROUTE = "route"
    GATHER_CRM = "gather_crm"
    GATHER_PAYMENTS = "gather_payments"
    GATHER_NEWS = "gather_news"
    SYNTHESIZE = "synthesize"
    FORMAT_BRIEF = "format_brief"


class IntentType(str, Enum):
    """Intent types returned by parse_intent and used for routing."""
    FULL_BRIEF = "full_brief"
    QUICK_UPDATE = "quick_update"
    NEWS_CHECK = "news_check"
    PAYMENT_CHECK = "payment_check"
    UNKNOWN = "unknown"
