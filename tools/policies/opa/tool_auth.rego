# ============================================================
# tools/policies/opa/tool_auth.rego
#
# Enterprise tool authorization policy.
#
# Every MCP tool call is evaluated here before execution.
# Default: DENY. Access must be explicitly granted.
#
# Input schema:
#   input.tool         string  — MCP tool name
#   input.session_id   string  — Agent session UUID
#   input.query        string  — SQL query (for data tools)
#   input.agent_role   string  — Role of the calling agent
#   input.environment  string  — "local" | "dev" | "prod"
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
    _select_query_only
    _agent_is_authorized
}

# ============================================================
# FUTURE TOOLS — add rules here as new MCP servers are added
#
# allow if {
#     input.tool == "search_documents"
#     _valid_session_id
#     _agent_is_authorized
#     input.agent_role in {"research_agent", "commercial_banking_agent"}
# }
#
# allow if {
#     input.tool == "call_internal_api"
#     _valid_session_id
#     _agent_is_authorized
#     input.agent_role == "transaction_agent"
# }
# ============================================================

# ---- Helper Rules -----------------------------------------------------------

# Session ID must be non-empty (UUID format is further validated in the MCP server)
_valid_session_id if {
    input.session_id != ""
    input.session_id != null
}

# Only SELECT statements are authorised at policy level
_select_query_only if {
    regex.match(`(?i)^\s*SELECT`, input.query)
}

# Agent identity authorisation
# In production, agent_role is injected from a signed JWT or service account.
_agent_is_authorized if {
    input.agent_role in {
        "commercial_banking_agent",
        "data_analyst_agent",
        "compliance_agent",
    }
}

# Bypass for local development — any role is accepted in the local environment
_agent_is_authorized if {
    input.environment == "local"
}
