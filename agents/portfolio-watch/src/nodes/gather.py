"""
Portfolio Watch — gather nodes.

gather_portfolio : loads the RM's client list via a PortfolioDataSource.
gather_signals   : loads payments, news, and credit signals for every client.

The data source is injectable — production uses JsonFileDataSource (local JSON
files), while tests can inject an in-memory fake.  This follows the same DI
pattern used throughout the platform SDK (Protocol + constructor injection).
"""
import json
from pathlib import Path
from typing import Optional

from platform_sdk import get_logger
from platform_sdk.protocols import PortfolioDataSource

log = get_logger(__name__)

_MOCK_DIR = Path(__file__).parent.parent.parent / "mock_data"


class JsonFileDataSource:
    """Default PortfolioDataSource that reads from local JSON files.

    Satisfies the PortfolioDataSource protocol without inheriting from it
    (structural subtyping via @runtime_checkable Protocol).
    """

    def __init__(self, data_dir: Optional[Path] = None) -> None:
        self._dir = data_dir or _MOCK_DIR

    def _load_json(self, filename: str) -> dict:
        path = self._dir / filename
        with open(path, "r") as f:
            return json.load(f)

    def load_clients(self, rm_id: str) -> list:
        all_clients = self._load_json("clients.json")
        return all_clients.get(rm_id, all_clients.get("rm001", []))

    def load_signals(self) -> tuple[dict, dict, dict]:
        payments_db = self._load_json("payments.json")
        news_db = self._load_json("news.json")
        credit_db = self._load_json("credit.json")
        return payments_db, news_db, credit_db


# Module-level default — used when no data source is injected.
_default_source = JsonFileDataSource()


# ── Node factories ─────────────────────────────────────────────────────────────

def make_gather_portfolio_node(data_source: Optional[PortfolioDataSource] = None):
    """Load all clients for the requesting RM.

    Args:
        data_source: Injectable data source. Defaults to JsonFileDataSource
                     reading from the mock_data directory.  Tests can inject
                     an in-memory fake.
    """
    source = data_source or _default_source

    async def gather_portfolio(state: dict) -> dict:
        rm_id = state.get("rm_id", "rm001").lower()
        try:
            clients = source.load_clients(rm_id)
            log.info("portfolio_loaded", rm_id=rm_id, count=len(clients))
            return {"clients": clients}
        except Exception as exc:
            log.error("portfolio_load_error", rm_id=rm_id, error=str(exc))
            return {"clients": []}

    return gather_portfolio


def make_gather_signals_node(data_source: Optional[PortfolioDataSource] = None):
    """
    Load payment, news, and credit signals for every client in state['clients'].

    Args:
        data_source: Injectable data source. Defaults to JsonFileDataSource.

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
    source = data_source or _default_source

    async def gather_signals(state: dict) -> dict:
        clients = state.get("clients", [])
        if not clients:
            log.warning("gather_signals: no clients in state")
            return {"signals": {}}

        try:
            payments_db, news_db, credit_db = source.load_signals()
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
