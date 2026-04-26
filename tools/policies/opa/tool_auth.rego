# ============================================================
# tools/policies/opa/tool_auth.rego
#
# Enterprise tool authorization policy.
#
# Every MCP tool call is evaluated here before execution.
# Default: DENY. Access must be explicitly granted.
#
# Two-layer authorization:
#   1. agent_role  — service-level identity (stamped by MCP server env)
#   2. user_role   — OAuth identity (from HMAC-signed _auth_context token,
#                    verified server-side before reaching OPA)
#
# Input schema:
#   input.tool         string  — MCP tool name
#   input.session_id   string  — Agent session UUID
#   input.query        string  — SQL query (for data tools)
#   input.agent_role   string  — Role of the MCP service (server-stamped)
#   input.user_role    string  — OAuth role (extracted from verified context)
# ============================================================

package mcp.tools

import rego.v1

# Default deny — explicit allow rules below
default allow := false

# ============================================================
# RULE: execute_read_query
#
# Authorised agents may run SELECT queries in their session schema.
# Mutating queries are blocked by the MCP server itself as a second
# layer of defence-in-depth (this policy is the first layer).
# ============================================================

allow if {
    input.tool == "execute_read_query"
    _valid_session_id
    _agent_is_authorized
    _user_is_authorized
}

# ============================================================
# RULE: Salesforce CRM Tools (get_salesforce_summary)
#
# RM Prep Agent retrieves Salesforce account, contact, activity,
# opportunity and task data for meeting preparation.
# ============================================================

allow if {
    input.tool == "get_salesforce_summary"
    _agent_is_authorized
    _user_is_authorized
}

# ============================================================
# RULE: Payment Transaction Tools (get_payment_summary)
#
# RM Prep Agent retrieves bank payment transaction data including
# volumes, corridors, and counterparty analysis.
# ============================================================

allow if {
    input.tool == "get_payment_summary"
    _agent_is_authorized
    _user_is_authorized
}

# ============================================================
# RULE: News Search Tools (search_company_news)
#
# RM Prep Agent searches internet news for company intelligence
# using Tavily API or mock data in development.
# ============================================================

allow if {
    input.tool == "search_company_news"
    _agent_is_authorized
    _user_is_authorized
}

# ============================================================
# RULE: Schema Context (get_schema_context)
#
# Returns live database schema (tables, columns, comments, FKs,
# text joins, perspectives). Metadata only — no row data — so we
# only require an authorized agent role. The user_role check is
# intentionally omitted so the agent can fetch schema at startup
# before any user request has arrived.
# ============================================================

allow if {
    input.tool == "get_schema_context"
    _agent_is_authorized
}

# ============================================================
# FUTURE TOOLS — add rules here as new MCP servers are added
#
# Example: restrict a tool to admin users only
# allow if {
#     input.tool == "admin_only_tool"
#     _agent_is_authorized
#     input.user_role == "admin"
# }
# ============================================================

# ---- Helper Rules -----------------------------------------------------------

# L7: Session ID must be a well-formed UUID (both layers enforce the same constraint).
# The MCP server performs the same check; having it here makes the policy
# independently enforceable and self-documenting.
_UUID_PATTERN := `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`

_valid_session_id if {
    input.session_id != ""
    input.session_id != null
    regex.match(_UUID_PATTERN, input.session_id)
}

# Service-level authorization
# agent_role is stamped by the MCP server from its own AGENT_ROLE env var.
# Callers cannot override this — it is defence-in-depth.
_agent_is_authorized if {
    input.agent_role in {
        "commercial_banking_agent",
        "data_analyst_agent",
        "compliance_agent",
        "rm_prep_agent",
    }
}

# User-level authorization (OAuth role from Auth0)
# user_role flows: Auth0 → dashboard → agent → HMAC-signed _auth_context → OPA input.
# The role is extracted from a cryptographically verified token — never from
# plaintext tool parameters or LLM output.
#
# Accepted roles:
#   admin   — full access to all tools and data
#   analyst — standard data analysis and visualization
#   viewer  — read-only access (same tools, restricted by row/col filters)
#
# No environment-based exceptions: dev and prod use the same policy.
# All users must authenticate via Auth0 — no anonymous access.
_user_is_authorized if {
    input.user_role in {"admin", "analyst", "viewer"}
}
