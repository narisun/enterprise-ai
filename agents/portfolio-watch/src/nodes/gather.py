"""
Portfolio Watch — gather nodes.

gather_portfolio : loads the RM's client list from mock data.
gather_signals   : loads payments, news, and credit signals for every client.

Both nodes use local JSON mock data — no MCP connection required.
"""
import json
from pathlib import Path

from platform_sdk import get_logger

log = get_logger(__name__)

_MOCK_DIR = Path(__file__).parent.parent.parent / "mock_data"


def _load_json(filename: str) -> dict:
    path = _MOCK_DIR / filename
    with open(path, "r") as f:
        return json.load(f)


# ── Node factories ─────────────────────────────────────────────────────────────

def make_gather_portfolio_node():
    """Load all clients for the requesting RM."""

    async def gather_portfolio(state: dict) -> dict:
        rm_id = state.get("rm_id", "rm001").lower()
        try:
            all_clients = _load_json("clients.json")
            clients = all_clients.get(rm_id, all_clients.get("rm001", []))
            log.info("portfolio_loaded", rm_id=rm_id, count=len(clients))
            return {"clients": clients}
        except Exception as exc:
            log.error("portfolio_load_error", rm_id=rm_id, error=str(exc))
            return {"clients": []}

    return gather_portfolio


def make_gather_signals_node():
    """
    Load payment, news, and credit signals for every client in state['clients'].

    Returns a `signals` dict keyed by client_id:
      {
        "C001": {
          "payments": {...},
          "news":     {...},
          "credit":   {...}
        },
        ...
      }
    """

    async def gather_signals(state: dict) -> dict:
        clients = state.get("clients", [])
        if not clients:
            log.warning("gather_signals: no clients in state")
            return {"signals": {}}

        try:
            payments_db = _load_json("payments.json")
            news_db     = _load_json("news.json")
            credit_db   = _load_json("credit.json")
        except Exception as exc:
            log.error("signals_load_error", error=str(exc))
            return {"signals": {}}

        signals = {}
        for client in clients:
            cid = client["client_id"]
            signals[cid] = {
                "client_name": client["name"],
                "payments": payments_db.get(cid, {"summary": "No payment data available"}),
                "news":     news_db.get(cid, {"articles": [], "adverse_news": False}),
                "credit":   credit_db.get(cid, {}),
            }

        log.info("signals_gathered", client_count=len(signals))
        return {"signals": signals}

    return gather_signals
