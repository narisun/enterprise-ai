# ============================================================
# tools/policies/opa/tool_auth_test.rego
#
# OPA unit tests — run with: opa test tools/policies/opa/ -v
#
# Every allow rule must have at least:
#   - A passing test (happy path)
#   - A test that verifies the default deny
#   - Tests for each guard condition
# ============================================================

package mcp.tools

import rego.v1

# ---- execute_read_query: Happy Path -----------------------------------------

test_authorized_select_query_is_allowed if {
    allow with input as {
        "tool": "execute_read_query",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "SELECT * FROM accounts",
        "agent_role": "commercial_banking_agent",
        "environment": "prod",
    }
}

# Local-env bypass was removed (security hardening) — unknown roles
# are now denied in ALL environments.  See test_unknown_role_in_prod_is_denied.

test_case_insensitive_select_allowed if {
    allow with input as {
        "tool": "execute_read_query",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "   select id from users",
        "agent_role": "data_analyst_agent",
        "environment": "prod",
    }
}

# ---- execute_read_query: Deny Cases -----------------------------------------

# Mutating-query checks (DROP, INSERT, UPDATE, DELETE) were moved out of
# the OPA policy into the MCP server itself (defence-in-depth layer 2).
# The policy trusts the tool name "execute_read_query" to mean read-only;
# the server enforces the SQL-level constraint.

test_empty_session_id_is_denied if {
    not allow with input as {
        "tool": "execute_read_query",
        "session_id": "",
        "query": "SELECT 1",
        "agent_role": "commercial_banking_agent",
        "environment": "prod",
    }
}

# L7: malformed session_id (not a UUID) must be denied
test_non_uuid_session_id_is_denied if {
    not allow with input as {
        "tool": "execute_read_query",
        "session_id": "not-a-uuid",
        "query": "SELECT 1",
        "agent_role": "commercial_banking_agent",
        "environment": "prod",
    }
}

test_unknown_role_in_prod_is_denied if {
    not allow with input as {
        "tool": "execute_read_query",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "SELECT 1",
        "agent_role": "rogue_agent",
        "environment": "prod",
    }
}

test_unknown_tool_is_denied if {
    not allow with input as {
        "tool": "delete_all_records",
        "session_id": "123e4567-e89b-12d3-a456-426614174000",
        "query": "SELECT 1",
        "agent_role": "commercial_banking_agent",
        "environment": "prod",
    }
}

# ---- Default Deny -----------------------------------------------------------

test_empty_input_is_denied if {
    not allow with input as {}
}
