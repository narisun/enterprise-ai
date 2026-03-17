"""
MCP Server Authorization Helpers
==================================
Shared utilities used by salesforce-mcp and payments-mcp to extract,
validate, and act on the AgentContext forwarded by the RM Prep orchestrator.

Usage in an MCP server tool handler:
    from mcp_auth import get_agent_context, build_row_filters_crm, build_col_mask

    @mcp.tool()
    async def get_salesforce_summary(client_name: str) -> str:
        ctx = get_agent_context()   # reads from ContextVar set by middleware
        if not ctx.can_access_account(resolved_account_id):
            return json.dumps({"error": "Access denied"})
        db = _base_db.with_filters(
            row_filters=ctx.build_row_filters_crm(),
            col_mask=ctx.build_col_mask(),
        )
        ...

Starlette middleware (add to FastMCP app via app.add_middleware or via
the FastMCP server's internal Starlette app):

    from mcp_auth import AgentContextMiddleware
    app.add_middleware(AgentContextMiddleware)
"""
from __future__ import annotations

import base64
import json
import logging
from contextvars import ContextVar
from typing import Any

log = logging.getLogger(__name__)

# ─── ContextVar ─────────────────────────────────────────────────────────────
# Each asyncio task serving an MCP request gets its own copy.
# The middleware populates it; tool handlers read it.
_agent_context_var: ContextVar[dict | None] = ContextVar("agent_context", default=None)

# ─── Column masks by clearance ────────────────────────────────────────────────
_AML_COLUMNS = frozenset({"AMLRiskCategory", "RiskRating", "KYCStatus", "FraudMonitoringSegment"})
_COMPLIANCE_COLUMNS = frozenset({
    "SanctionsScreeningStatus", "PEPFlag", "BSAAMLProgramRating", "SanctionsComplianceStatus"
})

# Role hierarchy
_ROLE_RANK: dict[str, int] = {
    "readonly": 0, "rm": 1, "senior_rm": 2, "manager": 3, "compliance_officer": 3,
}


def _decode_context_header(raw: str) -> dict:
    """Decode base64-JSON X-Agent-Context header value."""
    try:
        return json.loads(base64.b64decode(raw.encode()))
    except Exception as e:
        log.warning("failed to decode agent context header: %s", e)
        return {}


def get_agent_context() -> dict:
    """Return the agent context for the current request, or an empty dict."""
    return _agent_context_var.get() or {}


def set_agent_context(ctx: dict) -> None:
    """Set the agent context for the current async task."""
    _agent_context_var.set(ctx)


# ─── Policy helpers ──────────────────────────────────────────────────────────

def get_role(ctx: dict) -> str:
    return ctx.get("role", "readonly")


def get_role_rank(ctx: dict) -> int:
    return _ROLE_RANK.get(get_role(ctx), 0)


def is_authenticated(ctx: dict) -> bool:
    return bool(ctx.get("rm_id"))


def can_access_account(ctx: dict, account_id: str) -> bool:
    """True if this context is authorized to view the given CRM account."""
    role = get_role(ctx)
    if role in ("manager", "compliance_officer", "senior_rm"):
        return True
    assigned = ctx.get("assigned_account_ids", [])
    return account_id in assigned


def build_row_filters_crm(ctx: dict) -> dict[str, list[str]]:
    """
    Row-level filter for SFCRM queries.
    Standard RM: restrict to assigned accounts.
    Senior RM / Manager / Compliance: no restriction.
    """
    role = get_role(ctx)
    if role in ("manager", "compliance_officer", "senior_rm"):
        return {}
    assigned = ctx.get("assigned_account_ids", [])
    if assigned:
        return {"Account": assigned}
    # Safety: if role is rm but no accounts are assigned, deny all rows
    return {"Account": ["__DENY_ALL__"]}


def build_row_filters_payments(ctx: dict, party_names: list[str] | None = None) -> dict[str, list[str]]:
    """
    Row-level filter for BankDW queries.
    Party names are resolved externally from the account IDs.
    Senior RM / Manager / Compliance: no restriction.
    """
    role = get_role(ctx)
    if role in ("manager", "compliance_officer", "senior_rm"):
        return {}
    if party_names:
        return {"fact_payments": party_names, "dim_party": party_names}
    return {"fact_payments": ["__DENY_ALL__"]}


def build_col_mask(ctx: dict) -> list[str]:
    """
    Column-level mask based on compliance clearance.
    standard           → mask all AML + compliance columns
    aml_view           → mask only strict compliance columns (SanctionsScreeningStatus, PEPFlag, ...)
    compliance_full    → no masking
    """
    clearance: set[str] = set(ctx.get("compliance_clearance", ["standard"]))
    masked: set[str] = set()
    if "compliance_full" not in clearance:
        masked |= _COMPLIANCE_COLUMNS
    if "aml_view" not in clearance:
        masked |= _AML_COLUMNS
    return list(masked)


def check_access(ctx: dict, tool_name: str, resource: str | None = None) -> tuple[bool, str]:
    """
    Top-level access check: returns (allowed, reason).
    Called at the start of every tool handler.
    """
    if not is_authenticated(ctx):
        return False, "Unauthenticated — missing or invalid agent context"

    rank = get_role_rank(ctx)
    if rank < _ROLE_RANK["rm"]:
        return False, f"Role '{get_role(ctx)}' does not have tool access"

    return True, "ok"


# ─── Starlette Middleware ─────────────────────────────────────────────────────

class AgentContextMiddleware:
    """
    Starlette ASGI middleware that extracts X-Agent-Context from every
    request and stores it in a ContextVar for the duration of the request.

    Register on a FastMCP / Starlette app:
        from starlette.middleware import Middleware
        mcp._app.add_middleware(AgentContextMiddleware)
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] in ("http", "websocket"):
            headers = dict(scope.get("headers", []))
            raw = headers.get(b"x-agent-context", b"").decode()
            if raw:
                ctx = _decode_context_header(raw)
                token = _agent_context_var.set(ctx)
                try:
                    await self.app(scope, receive, send)
                finally:
                    _agent_context_var.reset(token)
                return
        await self.app(scope, receive, send)
