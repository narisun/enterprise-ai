"""Data gathering nodes for CRM, payments, and news."""
import json

from langchain_core.messages import HumanMessage

from platform_sdk import get_logger
from ..state import RMPrepState

log = get_logger(__name__)


def _make_route_node():
    """Route node that determines which agents to invoke."""
    # Note: follow_up / refinement / clarification are routed by the
    # conversation_router conditional edge and never reach this node.
    # Only new_task turns pass through route.
    _ROUTING_MAP = {
        "full_brief":    ["crm", "payments", "news"],
        "quick_update":  ["crm", "payments", "news"],
        "news_check":    ["news"],
        "payment_check": ["payments"],
    }

    async def route(state: RMPrepState) -> dict:
        agents = _ROUTING_MAP.get(state.get("intent_type", "full_brief"), ["crm", "payments", "news"])
        log.info("routing_decision", intent=state.get("intent_type"), agents=agents)
        return {"agents_to_invoke": agents}
    return route


def _make_gather_crm_node(crm_agent):
    """Gather CRM data for the specified client."""
    async def gather_crm(state: RMPrepState) -> dict:
        if "crm" not in state.get("agents_to_invoke", []):
            return {"crm_output": None}
        client = state.get("client_name", "")
        try:
            result = await crm_agent.ainvoke({
                "messages": [HumanMessage(content=f"Client to look up: {client}")]
            })
            output = result["messages"][-1].content
            # Extract account_id and account_name for the payments node.
            # account_name is the CANONICAL name from CRM (e.g. "Microsoft Corp.")
            # and must be used for bankdw exact-match lookups — not the raw
            # client_name the user typed, which may be partial or differently cased.
            account_id = None
            account_name = None
            try:
                data = json.loads(output)
                account_id = data.get("account_id")
                account_name = data.get("account_name")  # exact Salesforce Account.Name
            except (json.JSONDecodeError, AttributeError):
                pass
            log.info("crm_gathered", client=client, account_id=account_id, account_name=account_name)
            return {"crm_output": output, "account_id": account_id, "account_name": account_name}
        except Exception as exc:
            log.error("crm_gather_error", client=client, error=str(exc))
            return {
                "crm_output": json.dumps({"error": "crm_unavailable", "detail": str(exc)}),
                "error_states": {"crm": str(exc)},
            }
    return gather_crm


def _make_gather_payments_node(pay_agent):
    """Gather payments data for the specified client."""
    async def gather_payments(state: RMPrepState) -> dict:
        if "payments" not in state.get("agents_to_invoke", []):
            return {"payments_output": None}
        # Use account_name from CRM if available — it is the EXACT canonical name
        # that matches bankdw."fact_payments"."PayorName" / "dim_party"."PartyName".
        # Falling back to client_name (user-supplied) risks a name mismatch because
        # the payments SQL uses exact matching, unlike the CRM ILIKE fuzzy search.
        exact_name = state.get("account_name") or state.get("client_name", "")
        try:
            result = await pay_agent.ainvoke({
                "messages": [HumanMessage(content=f'Call get_payment_summary with client_name="{exact_name}"')]
            })
            output = result["messages"][-1].content
            log.info("payments_gathered", client=exact_name)
            return {"payments_output": output}
        except Exception as exc:
            log.error("payments_gather_error", client=exact_name, error=str(exc))
            return {
                "payments_output": json.dumps({"error": "payments_unavailable", "client_name": exact_name, "detail": str(exc)}),
                "error_states": {"payments": str(exc)},
            }
    return gather_payments


def _make_gather_news_node(news_agent):
    """Gather news data for the specified company."""
    async def gather_news(state: RMPrepState) -> dict:
        if "news" not in state.get("agents_to_invoke", []):
            return {"news_output": None}
        company = state.get("client_name", "")
        try:
            result = await news_agent.ainvoke({
                "messages": [HumanMessage(content=f"company_name={company}")]
            })
            output = result["messages"][-1].content
            log.info("news_gathered", company=company)
            return {"news_output": output}
        except Exception as exc:
            log.error("news_gather_error", company=company, error=str(exc))
            return {
                "news_output": json.dumps({"error": "news_unavailable", "detail": str(exc)}),
                "error_states": {"news": str(exc)},
            }
    return gather_news
