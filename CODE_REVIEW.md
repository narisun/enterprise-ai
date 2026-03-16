# Enterprise AI Platform — Code Review

**Reviewed by:** Claude (Software Engineering & Agent AI)
**Date:** 2026-03-15
**Scope:** Full codebase — `agents/`, `tools/`, `platform-sdk/`, `infra/`, `docker-compose.yml`, OPA policies

---

## Executive Summary

The codebase shows strong architectural discipline: configuration comes from the environment, no hardcoded secrets, structured logging, OPA policy-as-code, proper lifespan management, and good test coverage. The agent/MCP/LLM layering is clean and idiomatic for LangGraph + FastMCP.

The findings below are organised by severity. Several are straightforward fixes; a few are significant enough to block a production deployment.

---

## CRITICAL

### C1 — Live credentials present in `.env` on disk

**File:** `.env`

The `.env` file on disk contains what appear to be real, active credentials:

```
AZURE_API_KEY=29Pk34GeMNsjP6gUjF94...
AWS_ACCESS_KEY_ID=AKIAVXAWFM2K73U23JQS
AWS_SECRET_ACCESS_KEY=b2lTLU0HrXi+Mgx...
DYNATRACE_API_TOKEN=dt0c01.PD7AR6NBNIBB4...
CHAINLIT_AUTH_SECRET=a3a23dcdc8b03f5e...
INTERNAL_API_KEY=sk-ent-f62eecd98dbd01...
```

While the `.gitignore` correctly excludes `.env` and the file does not appear in git history, these credentials are plaintext on any machine that has cloned the repo and run the setup. If this machine or a developer laptop is compromised, all services are exposed.

**Recommended actions:**
1. Rotate all of the above credentials immediately.
2. Replace the checked-in `.env` with the `.env.example` template values — never populate the actual file beyond the template.
3. Consider enforcing secret scanning (e.g. `git-secrets` or GitHub Advanced Security) as a pre-commit hook to prevent accidental future commits.

---

## HIGH

### H1 — Auth fails OPEN when `INTERNAL_API_KEY` is not configured

**File:** `tools/chat-ui/chainlit_app.py`, lines 98–101

```python
if not INTERNAL_API_KEY:
    log.warning("auth_misconfigured", ...)
    return cl.User(identifier=username or "user", metadata={"role": "user"})
```

When `INTERNAL_API_KEY` is absent the system logs a warning and **grants access to every login attempt**. This is a fail-open pattern — anyone who reaches the UI can log in with any username/password combination. The correct behaviour is fail-closed: return `None` (deny) and surface an error to the operator.

**Suggested fix:**
```python
if not INTERNAL_API_KEY:
    log.error("auth_misconfigured", reason="INTERNAL_API_KEY not set — rejecting all logins")
    return None
```

---

### H2 — `SET search_path` leaks across connection-pool connections

**File:** `tools/data-mcp/src/server.py`, line 214

```python
await conn.execute(f"SET search_path TO {schema_name}, public")
```

`SET search_path` (without `LOCAL`) is a **session-level** setting. When asyncpg returns the connection to the pool after the transaction ends, the `search_path` is still set to the last session's workspace schema. The next request that acquires that connection will inherit the previous session's schema until it sets its own — creating a data isolation window between tool calls.

**Suggested fix:**
```python
await conn.execute(f"SET LOCAL search_path TO {schema_name}, public")
```
`SET LOCAL` confines the effect to the current transaction and is automatically reverted on commit/rollback, making it safe in a pool.

---

### H3 — OPA `environment == "local"` bypass is attacker-controlled

**File:** `tools/policies/opa/tool_auth.rego`, lines 81–83

```rego
_agent_is_authorized if {
    input.environment == "local"
}
```

The `environment` field comes from the caller's request body — it is not injected by a trusted authority. Any caller (including a compromised agent) can set `"environment": "local"` in the OPA input to skip the `agent_role` allowlist entirely. In production, the environment value should be stamped by the MCP server from its own configuration (e.g. an `ENVIRONMENT` env var), not passed through from untrusted input.

**Suggested fix:** In `_authorize_with_opa()`, read `os.environ.get("ENVIRONMENT", "prod")` server-side and merge it into `request_body["input"]` rather than relying on the caller to supply it.

---

### H4 — No input length validation on `/chat` endpoint

**File:** `agents/src/server.py`, lines 90–92

```python
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default-session"
```

There is no maximum length constraint on `message`. An attacker can submit a multi-megabyte payload that exhausts the LLM context window, drives up token costs, or causes memory pressure. `session_id` is also unconstrained — a very long session_id ends up in log entries and in the LangGraph `thread_id`.

**Suggested fix:**
```python
from pydantic import Field

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=32_000)
    session_id: Optional[str] = Field("default-session", max_length=128)
```

---

### H5 — Redis has no authentication configured

**Files:** `platform/config/litellm-prod.yaml` (lines 41–43), `docker-compose.yml` (lines 52–60)

The Redis instance used for LiteLLM's response cache runs with no password in both local and production configurations. A service on the same network (or VPC) can read, modify, or delete cached LLM responses — potentially injecting false responses or poisoning the cache.

**Suggested fix:** Add `redis_password: os.environ/REDIS_PASSWORD` to `litellm-prod.yaml`'s `litellm_settings` block and set an `--requirepass` flag (or use a `redis.conf`) in both Compose and the Helm chart.

---

## MEDIUM

### M1 — `is_interactive` logging condition has an operator-precedence bug

**File:** `platform-sdk/platform_sdk/logging.py`, line 40

```python
is_interactive = os.getenv("TERM") or os.getenv("CI") is None
```

Due to Python's operator precedence, this parses as:

```python
is_interactive = os.getenv("TERM") or (os.getenv("CI") is None)
```

The intended logic is "we are interactive if a terminal is present **and** we are not in CI". The `or` makes this true whenever `TERM` is set, including inside a CI runner that happens to set `TERM`. The result is that JSON logging is silently disabled in CI pipelines that set `TERM`.

**Suggested fix:**
```python
is_interactive = bool(os.getenv("TERM")) and os.getenv("CI") is None
```

---

### M2 — `litellm-prod.yaml` fallbacks are self-referential

**File:** `platform/config/litellm-prod.yaml`, line 52

```yaml
fallbacks: [{"complex-routing": ["complex-routing"]}, {"fast-routing": ["fast-routing"]}]
```

Each route falls back to itself. LiteLLM will retry the same route list rather than crossing over to the other tier. The intended behaviour (Azure → Bedrock failover) is already expressed by having two models under the same `model_name`, so LiteLLM handles that automatically. If the intent is cross-tier fallback, the entries should reference the other route name; if LiteLLM's built-in load balancing is sufficient, this block can be removed entirely to avoid confusion.

---

### M3 — `on_chat_start` makes a redundant second MCP round-trip

**File:** `tools/chat-ui/chainlit_app.py`, lines 158–163

```python
ok = await _init_session(session_id, username)

if ok:
    agent = cl.user_session.get("agent")
    bridge = cl.user_session.get("bridge")
    tools = await bridge.get_langchain_tools()   # Second call — already done inside _init_session
    tool_names = [t.name for t in tools]
```

`_init_session` already calls `bridge.get_langchain_tools()` internally. The welcome-message block immediately calls it again, causing an unnecessary second SSE round-trip on every new session. Store the tool names in the session inside `_init_session` and read them back here.

---

### M4 — No healthcheck on the `ai-agents` service

**File:** `docker-compose.yml`

Every other service in Compose has a `healthcheck` block, but `ai-agents` does not. Docker cannot report when the service is actually ready (startup includes MCP handshake and LangGraph initialisation), and dependent services/orchestrators have no readiness signal to wait on.

**Suggested fix:** Add a healthcheck that calls the existing `/health` endpoint:
```yaml
healthcheck:
  test: ["CMD", "python3", "-c",
         "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
  interval: 15s
  timeout: 5s
  retries: 5
  start_period: 30s
```

---

### M5 — `AGENT_RECURSION_LIMIT` has no bounds validation

**Files:** `agents/src/server.py` (line 34), `tools/chat-ui/chainlit_app.py` (line 46)

```python
RECURSION_LIMIT = int(os.environ.get("AGENT_RECURSION_LIMIT", "10"))
```

There is no minimum or maximum guard. Setting this to `0` or a very large number (`10000`) would either prevent the agent from taking any actions or allow a runaway ReAct loop that exhausts tokens and budget.

**Suggested fix:**
```python
_raw = int(os.environ.get("AGENT_RECURSION_LIMIT", "10"))
RECURSION_LIMIT = max(1, min(_raw, 50))
```

---

### M6 — `server.py` 500 error leaks internal configuration detail

**File:** `agents/src/server.py`, line 81

```python
raise HTTPException(status_code=500, detail="Server misconfigured: INTERNAL_API_KEY not set")
```

This error message reveals that the service uses an `INTERNAL_API_KEY` and that it is missing — information useful to an attacker enumerating the service's configuration. A generic 500 message is appropriate here.

**Suggested fix:**
```python
raise HTTPException(status_code=500, detail="Service temporarily unavailable. Contact your administrator.")
```
Log the specific reason internally (already done by the surrounding logic).

---

### M7 — `asyncpg.connect()` in `init_db.py` has no connection timeout

**File:** `tools/chat-ui/init_db.py`, line 103

```python
conn = await asyncpg.connect(dsn)
```

If PostgreSQL is not yet reachable (e.g. during a rolling deploy), this call blocks indefinitely, hanging the container startup. The `entrypoint.sh` uses `set -e`, so a timeout-based failure would correctly abort startup.

**Suggested fix:**
```python
conn = await asyncpg.connect(dsn, timeout=30)
```

---

### M8 — SELECT regex does not block multi-statement queries

**File:** `tools/data-mcp/src/server.py`, line 206

```python
if not re.match(r"^\s*SELECT", query, re.IGNORECASE):
    return "ERROR: Security policy violation — only SELECT queries are permitted."
```

A query like `SELECT 1; DROP TABLE accounts;` passes this check. The primary safeguard is the `readonly=True` transaction (which correctly prevents DML/DDL), but defence-in-depth suggests the regex should also reject semicolons.

**Suggested fix:**
```python
if not re.match(r"^\s*SELECT\b", query, re.IGNORECASE) or ";" in query:
    return "ERROR: Security policy violation — only single SELECT queries are permitted."
```
Adding `\b` also prevents a hypothetical `SELECTBADTHING` prefix from passing.

---

### M9 — Terraform RDS security group allows all egress

**File:** `infra/terraform/rds/main.tf`, lines 43–49

```hcl
egress {
  from_port   = 0
  to_port     = 0
  protocol    = "-1"
  cidr_blocks = ["0.0.0.0/0"]
}
```

RDS instances do not initiate outbound connections in normal operation. Allowing all egress provides no defensive value and violates the principle of least privilege. Remove the egress rule entirely (AWS security groups are stateful — existing inbound connections can reply without an explicit egress rule).

---

### M10 — Terraform `secret_string` may be JSON-encoded

**File:** `infra/terraform/rds/main.tf`, line 86

```hcl
password = data.aws_secretsmanager_secret_version.db_password.secret_string
```

AWS Secrets Manager commonly stores secrets as JSON objects (e.g. `{"username":"dbadmin","password":"abc123"}`). If that pattern is used, `secret_string` is the whole JSON blob, not just the password, and RDS creation will fail or use a malformed password.

**Suggested fix (if secret is JSON):**
```hcl
password = jsondecode(data.aws_secretsmanager_secret_version.db_password.secret_string)["password"]
```
Document the expected secret structure in `variables.tf`.

---

## LOW / CONSISTENCY

### L1 — Inconsistent logging backends between `data-mcp` and other services

**File:** `tools/data-mcp/src/server.py`, lines 33–38

`data-mcp` uses Python's stdlib `logging.basicConfig` directly, while every other service in the platform uses the shared `platform_sdk.configure_logging()` / `get_logger()` which emits structured JSON via structlog. This means `data-mcp` logs will have a different schema in aggregation tools (Dynatrace, CloudWatch), breaking cross-service correlation dashboards and alerts.

**Suggested fix:** Replace the stdlib setup and all `log.info(...)` calls in `data-mcp/src/server.py` with `from platform_sdk import configure_logging, get_logger`.

---

### L2 — `pydantic.Field` imported inside a loop

**File:** `agents/src/mcp_bridge.py`, lines 49–54

```python
for field_name, field_schema in properties.items():
    ...
    if field_name in required_fields:
        from pydantic import Field    # re-imported on every iteration
        ...
    else:
        from pydantic import Field    # re-imported on every iteration
```

`pydantic.Field` is imported twice per loop iteration. Python caches imports after the first call, so this is not a correctness issue, but it's misleading and inconsistent with the top-level imports elsewhere in the file. Move both imports to the top of the module.

---

### L3 — `test_raises_on_missing_api_key` test logic is fragile

**File:** `agents/tests/test_graph.py`, lines 48–57

```python
def test_raises_on_missing_api_key(self, monkeypatch):
    monkeypatch.delenv("INTERNAL_API_KEY", raising=False)
    with pytest.raises(ValueError, match="INTERNAL_API_KEY"):
        from src.graph import build_enterprise_agent   # ← cached module used here
        import importlib
        import src.graph as graph_module
        importlib.reload(graph_module)
        graph_module.build_enterprise_agent([])
```

The `from src.graph import build_enterprise_agent` line at the top of the `with` block may bind the already-cached (pre-env-change) version of the function. The test relies on `importlib.reload` further down, but the initial import could prevent the `ValueError` from ever being raised if the module was already loaded. Move the `importlib.reload` call before the `pytest.raises` context, then call `graph_module.build_enterprise_agent([])` inside it.

---

### L4 — Docker Compose ports bind to all interfaces in local dev

**File:** `docker-compose.yml`

PostgreSQL (5432), LiteLLM (4000), data-mcp (8080), and ai-agents (8000) are all exposed as `"HOST:CONTAINER"` with no interface restriction. On a developer laptop connected to a shared network these services are reachable from other machines on the subnet.

**Suggested fix for local-only access:**
```yaml
ports:
  - "127.0.0.1:5432:5432"
```

---

### L5 — `litellm-prod.yaml` hardcodes `aws_region_name`

**File:** `platform/config/litellm-prod.yaml`, lines 23 and 37

```yaml
aws_region_name: us-east-1
```

If the Bedrock deployment region ever changes, both entries must be updated manually. Prefer `os.environ/AWS_DEFAULT_REGION` (consistent with how Azure params are referenced) so the region is controlled by the EKS pod's environment.

---

### L6 — `_make_invoke_fn` swallows exceptions silently

**File:** `agents/src/mcp_bridge.py`, lines 73–76

```python
except Exception as exc:
    log.error("mcp_tool_error", tool=tool_name, error=str(exc))
    return f"Tool execution error: {exc}"
```

Returning an error string rather than raising means LangGraph treats every tool failure as a successful tool call with an error-string payload. The agent may continue reasoning on that error string and produce hallucinated follow-up steps rather than stopping or surfacing the failure. Consider re-raising specific, recoverable exception types and only returning the error string for benign "no results" cases.

---

### L7 — `OPA _valid_session_id` only checks non-empty

**File:** `tools/policies/opa/tool_auth.rego`, lines 60–63

```rego
_valid_session_id if {
    input.session_id != ""
    input.session_id != null
}
```

UUID format validation is deferred entirely to the MCP server. The OPA comment says "UUID format is further validated in the MCP server", which is true, but the two layers of defence should enforce the same constraint. OPA's `regex.match` supports the same UUID pattern used in the MCP server, making the policy self-documenting and independently enforceable.

---

### L8 — Jinja2 `autoescape=False` should have a comment explaining the risk

**File:** `agents/src/graph.py`, line 17

```python
_jinja_env = Environment(loader=FileSystemLoader(str(_PROMPT_DIR)), autoescape=False)
```

`autoescape=False` is correct for prompt templates (not HTML), but as the prompt system grows it will be tempting to pass user-supplied context into `load_system_prompt`. A comment at the call-site noting that user data should never be interpolated directly into templates — and that `{{ }}` in user messages must be sanitised or passed as data, not template variables — would help future maintainers avoid prompt injection.

---

## Summary Table

| ID | Severity | File | Issue |
|----|----------|------|-------|
| C1 | Critical | `.env` | Live credentials on disk — rotate immediately |
| H1 | High | `chainlit_app.py` | Auth fails open when `INTERNAL_API_KEY` missing |
| H2 | High | `data-mcp/server.py` | `SET search_path` not scoped to transaction (`LOCAL`) |
| H3 | High | `tool_auth.rego` | `environment == "local"` bypass is caller-controlled |
| H4 | High | `agents/server.py` | No length limit on `ChatRequest.message` |
| H5 | High | `litellm-prod.yaml`, `docker-compose.yml` | Redis has no authentication |
| M1 | Medium | `platform_sdk/logging.py` | `is_interactive` uses `or` instead of `and` |
| M2 | Medium | `litellm-prod.yaml` | Fallbacks are self-referential (no cross-tier failover) |
| M3 | Medium | `chainlit_app.py` | Redundant second `get_langchain_tools()` call on session start |
| M4 | Medium | `docker-compose.yml` | No healthcheck on `ai-agents` service |
| M5 | Medium | `server.py`, `chainlit_app.py` | No bounds check on `AGENT_RECURSION_LIMIT` |
| M6 | Medium | `agents/server.py` | 500 error message leaks config detail |
| M7 | Medium | `init_db.py` | `asyncpg.connect()` has no timeout |
| M8 | Medium | `data-mcp/server.py` | SELECT regex doesn't block semicolons |
| M9 | Medium | `terraform/rds/main.tf` | RDS egress allows all outbound traffic |
| M10 | Medium | `terraform/rds/main.tf` | `secret_string` may be JSON — use `jsondecode` |
| L1 | Low | `data-mcp/server.py` | Inconsistent logging backend vs platform SDK |
| L2 | Low | `mcp_bridge.py` | `pydantic.Field` imported inside loop |
| L3 | Low | `test_graph.py` | `test_raises_on_missing_api_key` is fragile |
| L4 | Low | `docker-compose.yml` | Dev ports exposed on all interfaces |
| L5 | Low | `litellm-prod.yaml` | Hardcoded `aws_region_name` |
| L6 | Low | `mcp_bridge.py` | Tool exceptions returned as strings (masks LangGraph errors) |
| L7 | Low | `tool_auth.rego` | OPA `_valid_session_id` does not validate UUID format |
| L8 | Low | `graph.py` | `autoescape=False` needs a comment warning against user-data injection |

---

## What's Working Well

The following design choices are sound and worth preserving:

- **Fail-closed OPA integration** — any timeout or HTTP error from OPA returns `False` (deny). This is exactly right.
- **`SET LOCAL` fix opportunity aside**, using a `readonly=True` asyncpg transaction as the final SQL guard is solid defence-in-depth.
- **Lifespan context managers** used correctly in both FastAPI (`agents/server.py`) and FastMCP (`data-mcp/server.py`) — no deprecated `@app.on_event` patterns.
- **No secrets hardcoded** anywhere in source files — all read from environment at runtime.
- **Schema-per-session isolation** (`ws_{uuid}`) is a clean multi-tenant data model.
- **Structured logging with correlation IDs** via OpenTelemetry context propagation throughout the platform SDK.
- **OPA policy tests** (`tool_auth_test.rego`) cover happy path, deny cases, and default deny — good policy-as-code hygiene.
- **Pinned image versions** in `docker-compose.yml` prevent unexpected upstream changes.
- **`_make_invoke_fn` factory** correctly avoids the classic loop-closure bug with a dedicated factory function.
