# Troubleshooting Knowledge Base

This document records every error encountered during setup and development of this platform, along with the root cause and exact fix. Search by error message or symptom.

---

## Setup & Installation

---

### `E: The repository 'https://apt.kubernetes.io kubernetes-xenial Release' does not have a Release file`

**When:** Running `sudo apt update` on Ubuntu (WSL2 or native).

**Root cause:** An old deprecated Google Kubernetes apt repository (`kubernetes-xenial`) was left in `/etc/apt/sources.list.d/`. Google removed this repository and it no longer resolves.

**Fix:**
```bash
sudo rm /etc/apt/sources.list.d/kubernetes.list
sudo apt update
```

**Note:** `kubectl` is not required to run `make dev-up` (which uses Docker Compose). It is only needed for direct Kubernetes cluster interaction. Install it separately when needed.

---

### `E: Unable to locate package helm`

**When:** Running `sudo apt install helm` on Ubuntu.

**Root cause:** Helm is not in the default Ubuntu apt repositories. The snap version requires `--classic` and has known issues with WSL2's systemd configuration.

**Fix:** Use the official Helm install script:
```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

---

### `E: Unable to locate package opa`

**When:** Running `sudo apt install opa` on Ubuntu.

**Root cause:** OPA is not packaged in Ubuntu apt repositories.

**Fix:** Download the static binary directly from GitHub Releases:
```bash
curl -L -o opa https://github.com/open-policy-agent/opa/releases/download/v0.65.0/opa_linux_amd64_static \
  && chmod +x opa \
  && sudo mv opa /usr/local/bin/opa
```

---

### `pip: No such file or directory` on `make sdk-install`

**When:** Running `make sdk-install` on Ubuntu.

**Root cause:** Ubuntu uses `pip3` and `python3` as the binary names; the original Makefile used bare `pip` and `python` which are not installed by default.

**Fix:** The Makefile was updated to use `python3 -m pip` and `python3 -m pytest` instead:
```makefile
PIP    := $(VENV)/bin/python3 -m pip
PYTEST := $(VENV)/bin/python3 -m pytest
```

---

### `error: externally-managed-environment` on `pip install`

**When:** Running any `pip install` on Ubuntu 24.04.

**Root cause:** Ubuntu 24.04 implements PEP 668, which prevents pip from modifying the system Python installation to avoid conflicts with apt-managed packages.

**Fix:** All Python work must happen inside a virtual environment. The Makefile was updated to auto-create `.venv/`:
```bash
sudo apt install python3-full -y   # required for venv support
make sdk-install                    # creates .venv/ and installs SDK
```

---

### `BackendUnavailable: No module named 'setuptools.backends'`

**When:** Running `make sdk-install` (specifically the `pip install -e platform-sdk/` step).

**Root cause:** `platform-sdk/pyproject.toml` had an incorrect `build-backend` value:
```toml
# Wrong — this module path does not exist
build-backend = "setuptools.backends.legacy:build"
```

**Fix:** Change to the correct standard value in `platform-sdk/pyproject.toml`:
```toml
build-backend = "setuptools.build_meta"
```

---

## Docker Compose Stack

---

### `Error response from daemon: manifest unknown` for LiteLLM image

**When:** Running `make dev-up` — Docker fails to pull the LiteLLM image.

**Root cause:** The LiteLLM GitHub Container Registry uses a `main-` prefix on all version tags. The tag `v1.43.0` does not exist; the correct tag is `main-v1.43.0`.

**Fix:** Update `docker-compose.yml`:
```yaml
# Wrong
litellm: &img-litellm  ghcr.io/berriai/litellm:v1.43.0

# Correct
litellm: &img-litellm  ghcr.io/berriai/litellm:main-v1.43.0
```

---

### OPA container `unhealthy` — healthcheck failing

**When:** `make dev-up` — `ai-opa` starts but never becomes healthy.

**Root cause:** The OPA standard image is distroless (built on `gcr.io/distroless/base`). It contains only the `/opa` binary — no `wget`, `curl`, or shell. The Docker healthcheck was using `wget` which is unavailable.

**Fix:** Switch to the `-debug` variant which includes busybox utilities:
```yaml
# docker-compose.yml
opa: &img-opa  openpolicyagent/opa:0.65.0-debug
```
And use the OPA health endpoint with the `?plugins` query param:
```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:8181/health?plugins"]
```

The `-debug` variant is identical in behaviour to the standard image and also allows `docker exec -it ai-opa sh` for interactive policy debugging.

---

### `data-mcp` container exits with code 1 immediately

**When:** `make dev-up` — `ai-data-mcp` starts and immediately exits.

**Root cause (1 — import crash):** The health endpoint code in `server.py` imported from `fastapi`:
```python
try:
    from fastapi.responses import JSONResponse   # ← fastapi is NOT installed in data-mcp
    @mcp.server.get("/health")
    ...
except AttributeError:    # ← only catches AttributeError, not ModuleNotFoundError
    pass
```
`fastapi` is not a dependency of `mcp[cli]` (which uses `starlette`). The `ModuleNotFoundError` was not caught, crashing the process.

**Root cause (2 — event loop bug):** Even if the crash was fixed, there was a second bug:
```python
asyncio.run(_init())     # Creates asyncpg pool on event loop #1
mcp.run(transport="sse") # Creates event loop #2 — pool is now on a dead loop
```

**Fix:** Rewrote `server.py` to use FastMCP's `lifespan` context manager, which ensures all async resources are created inside FastMCP's own event loop:
```python
@asynccontextmanager
async def _lifespan(server: FastMCP) -> AsyncIterator[None]:
    global _db_pool, _opa_client
    _opa_client = httpx.AsyncClient(...)
    _db_pool = await asyncpg.create_pool(...)
    yield
    await _db_pool.close()
    await _opa_client.aclose()

mcp = FastMCP("Enterprise Data MCP", lifespan=_lifespan, host="0.0.0.0", port=8080)
```
The Docker healthcheck was also changed to a TCP port check using Python (always available as the container runtime):
```yaml
test: ["CMD", "python3", "-c",
       "import socket,sys; s=socket.socket(); r=s.connect_ex(('localhost',8080)); s.close(); sys.exit(0 if r==0 else 1)"]
```

---

### `Exception: Master key must be a string. Current type - <class 'NoneType'>`

**When:** LiteLLM container starts then exits with code 3.

**Root cause:** `litellm-local.yaml` reads `master_key: os.environ/INTERNAL_API_KEY` but the `docker-compose.yml` only injected `LITELLM_MASTER_KEY` into the LiteLLM container — not `INTERNAL_API_KEY` itself. The config's `os.environ/INTERNAL_API_KEY` lookup returned `None`.

**Fix:** Add `INTERNAL_API_KEY` explicitly to the litellm service environment in `docker-compose.yml`:
```yaml
litellm:
  environment:
    INTERNAL_API_KEY: ${INTERNAL_API_KEY}      # read by litellm-local.yaml
    LITELLM_MASTER_KEY: ${INTERNAL_API_KEY}    # LiteLLM auto-detects as fallback
```

**Also check:** Ensure `.env` has a non-empty value for `INTERNAL_API_KEY`. Generate one with:
```bash
python3 -c "import secrets; print('sk-ent-' + secrets.token_hex(24))"
```

---

### LiteLLM container `unhealthy` — healthcheck keeps failing despite server running

**When:** `make dev-up` — LiteLLM logs show `Application startup complete` but Docker marks it unhealthy after ~120 seconds.

**Root cause (1):** The healthcheck used `/health` which calls all configured upstream LLM providers. If Azure credentials are not yet configured, this returns unhealthy.

**Root cause (2):** The LiteLLM image does not include `curl` or `wget` — the `CMD curl` healthcheck silently fails with `executable file not found`.

**Root cause (3):** `python3` (bare name) may not resolve in the container's healthcheck PATH even though Python is installed as the runtime. Using the absolute path `/usr/local/bin/python3` fixes this.

**Fix — healthcheck in `docker-compose.yml`:**
```yaml
test: ["CMD", "/usr/local/bin/python3", "-c",
       "import socket,sys; s=socket.socket(); r=s.connect_ex(('localhost',4000)); s.close(); sys.exit(0 if r==0 else 1)"]
```

**Fix — agent dependency condition:**
Changed `ai-agents` to use `service_started` (not `service_healthy`) for the litellm dependency as a fallback, since the agent retries LiteLLM connections at request time anyway. Reverted back to `service_healthy` once the TCP healthcheck was confirmed working.

---

### `AzureException NotFoundError - The API deployment for this resource does not exist`

**When:** Calling `POST /chat` — agent returns HTTP 500, logs show Azure 404.

**Root cause:** The LiteLLM config specifies `model: azure/gpt-4o-mini` but the actual Azure OpenAI deployment has a different name (e.g. `gpt-4o-mini-deployment`). The deployment name in the config must exactly match the name shown in Azure Portal → OpenAI resource → Model deployments.

**Fix:** Update `platform/config/litellm-local.yaml`:
```yaml
model: azure/YOUR-ACTUAL-DEPLOYMENT-NAME
```
Then restart LiteLLM (config-only change — no rebuild needed):
```bash
docker restart ai-litellm
```

---

## Python / Tests

---

### `TypeError: Logger._log() got an unexpected keyword argument`

**When:** Agent service starts — logs show a TypeError, or `docker logs ai-agents` is empty (crash before logging).

**Root cause:** Code was using `logging.getLogger(__name__)` (standard Python logging) but calling it with structlog-style keyword arguments:
```python
log = logging.getLogger(__name__)
log.info("agent_starting", mcp_url=url)   # ← TypeError: unexpected kwarg
```
Standard Python loggers do not accept keyword arguments. Only structlog loggers do.

**Fix:** Use `get_logger` from `platform_sdk` which returns a structlog-bound logger:
```python
from platform_sdk import configure_logging, get_logger, setup_telemetry
log = get_logger(__name__)   # ← now accepts keyword arguments
```
This applies to `agents/src/server.py` and `agents/src/mcp_bridge.py`.

---

### `make test` — `/bin/sh: .venv/bin/python3: not found`

**When:** Running `make test` or `make test-agents`.

**Root cause:** The Makefile defines `PYTEST := $(VENV)/bin/python3 -m pytest` as a relative path. The test target then does `cd agents && $(PYTEST) tests/` — after the `cd`, the relative `.venv/` path no longer resolves.

**Fix:** Prefix the pytest command with `$(REPO_ROOT)` (already defined at the top of the Makefile):
```makefile
test-agents: sdk-install
    cd agents && $(REPO_ROOT)/$(PYTEST) tests/ -v --tb=short
```

---

### `make test` — `No module named pytest`

**When:** Running `make test` — Python resolves but pytest is not found.

**Root cause:** The `.venv` was created by `make sdk-install` which only installs `platform-sdk`. The service dependencies (`pytest`, `langchain-openai`, etc.) were never installed into the venv.

**Fix:** Each test target now installs its service's `requirements.txt` before running:
```makefile
test-agents: sdk-install
    $(PIP) install -r agents/requirements.txt --quiet
    cd agents && $(REPO_ROOT)/$(PYTEST) tests/ -v --tb=short
```

---

### `ValueError: The first argument must be a string or a callable with a __name__` in agent tests

**When:** Running `make test-agents` — `test_builds_successfully_with_tools` fails.

**Root cause:** The test passed bare `MagicMock()` objects as tools to `build_enterprise_agent`. LangGraph ≥ 1.0 introduced stricter tool validation in `ToolNode` — it now calls `create_tool()` on each tool, which requires a `BaseTool` instance or a callable with `__name__`. A `MagicMock` satisfies neither.

**Fix:** Patch `create_react_agent` in addition to `ChatOpenAI`. The test is a unit test for `build_enterprise_agent`'s logic, not for LangGraph internals:
```python
with patch("src.graph.ChatOpenAI"), patch("src.graph.create_react_agent") as mock_agent:
    mock_agent.return_value = MagicMock()
    agent = build_enterprise_agent(tools)
```

---

### `LangGraphDeprecatedSinceV10: create_react_agent has been moved`

**When:** Running tests — a deprecation warning appears but tests still pass.

**Root cause:** LangGraph 1.0 deprecated `from langgraph.prebuilt import create_react_agent`.

**Status:** Warning only — the import still works in LangGraph 1.x. The `langchain.agents.create_react_agent` alternative has a different API signature (`PromptTemplate` instead of string for `prompt=`) and is not a drop-in replacement. Migration requires changing the `prompt=` parameter to `state_modifier=` in `build_enterprise_agent`. Deferred — tracked as a future improvement.

---

## Git

---

### `remote: error: File skaffold is 121.31 MB; this exceeds GitHub's file size limit of 100.00 MB`

**When:** Running `git push` — push is rejected.

**Root cause:** The `skaffold` binary (downloaded to the repo root during setup) was committed to git. Binaries should be installed system-wide, never tracked in the repository.

**Fix:**
```bash
# Remove from git tracking (keeps the file on disk)
git rm --cached skaffold

# Commit the removal
git add .gitignore
git commit -m "Remove skaffold binary, add tool binaries to .gitignore"
git push
```

The following entries were added to `.gitignore` to prevent recurrence:
```
skaffold
skaffold.exe
opa
opa.exe
helm
kubectl
```

---

## Diagnosing Unknown Issues

When a container fails with no obvious error, use these commands:

```bash
# See last 50 lines from a specific container
docker logs <container-name> --tail 50

# Follow logs in real time
docker logs <container-name> -f

# Run a command inside a running container
docker exec -it <container-name> sh

# Inspect the healthcheck status
docker inspect <container-name> --format '{{json .State.Health}}' | python3 -m json.tool

# See all container states
docker compose ps

# Check what's actually listening on a port
ss -tlnp | grep 8080
```
