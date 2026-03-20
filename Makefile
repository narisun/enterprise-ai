# ============================================================
# enterprise-ai — Developer Commands
# ============================================================
.PHONY: help dev-up dev-test-up dev-down dev-reset dev-restart dev-logs dev-status \
        test test-agents test-mcp test-policies \
        lint format build sdk-install \
        k8s-dev k8s-prod k8s-down clean

REPO_ROOT := $(shell pwd)

# ---- Virtual environment ------------------------------------------------
# All Python commands run inside .venv/ so we never touch the system Python.
# The venv is created automatically by `make sdk-install`.
# To use Python manually outside of make: source .venv/bin/activate
VENV   := .venv
PYTHON := $(VENV)/bin/python3
PIP    := $(VENV)/bin/python3 -m pip
PYTEST := $(VENV)/bin/python3 -m pytest

# Internal target: create the venv if it doesn't already exist
$(VENV)/bin/python3:
	python3 -m venv $(VENV)
	@echo "✅ Virtual environment created at $(VENV)/"

help:  ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ---- Local Development (Docker Compose) --------------------

# Base compose files used by every dev target.
# dev-test-up adds the test overlay which seeds salesforce + bankdw schemas.
COMPOSE_BASE := docker compose -f docker-compose.yml
COMPOSE_TEST := $(COMPOSE_BASE) -f docker-compose.test.yml

dev-up: ## Start the stack without test fixtures (prod-schema only)
	@echo "→ Checking for .env file..."
	@test -f .env || (echo "ERROR: .env not found. Run: cp .env.example .env" && exit 1)
	$(COMPOSE_BASE) up --build -d
	@echo ""
	@echo "✅ Local stack is running (no test fixtures — salesforce/bankdw schemas absent)."
	@echo "   Use 'make dev-test-up' to include Salesforce + bankdw test data."
	@echo ""
	@echo "   🌐 Chat UI       → http://localhost:8501"
	@echo "   🤖 Agent API     → http://localhost:8000"
	@echo "   🔀 LiteLLM Proxy → http://localhost:4000"
	@echo "   🛠  Data MCP      → http://localhost:8080"
	@echo "   📡 OTel Collector → http://localhost:4318"
	@echo "   🗄  PostgreSQL    → localhost:5432"
	@echo ""
	@echo "   Run 'make dev-logs' to follow all logs."

dev-test-up: ## Start the full stack WITH Salesforce + bankdw test fixtures (use for local dev)
	@echo "→ Checking for .env file..."
	@test -f .env || (echo "ERROR: .env not found. Run: cp .env.example .env" && exit 1)
	$(COMPOSE_TEST) up --build -d
	@echo ""
	@echo "✅ Local stack is running with test fixtures:"
	@echo "   salesforce.* and bankdw.* schemas seeded from testdata/ CSVs."
	@echo ""
	@echo "   🌐 Chat UI       → http://localhost:8501  (SHOW_TEST_LOGIN=true)"
	@echo "   🤖 Agent API     → http://localhost:8000"
	@echo "   🔀 LiteLLM Proxy → http://localhost:4000"
	@echo "   🛠  Data MCP      → http://localhost:8080"
	@echo "   📡 OTel Collector → http://localhost:4318"
	@echo "   🗄  PostgreSQL    → localhost:5432"
	@echo ""
	@echo "   Run 'make dev-logs' to follow all logs."

dev-down: ## Stop and remove all containers (works for both dev-up and dev-test-up)
	$(COMPOSE_TEST) down

dev-reset: ## Wipe the pgdata volume and restart with test fixtures (required after first dev-up)
	@echo "→ Stopping containers and removing pgdata volume..."
	$(COMPOSE_TEST) down -v
	@echo "→ Rebuilding and starting with test fixtures..."
	$(COMPOSE_TEST) up --build -d
	@echo ""
	@echo "✅ Fresh stack with test fixtures:"
	@echo "   salesforce.* and bankdw.* schemas seeded from testdata/ CSVs."
	@echo ""
	@echo "   🌐 Chat UI  → http://localhost:8501  (SHOW_TEST_LOGIN=true)"
	@echo "   🗄  PostgreSQL → localhost:5432"

dev-restart: ## Restart all containers
	$(COMPOSE_TEST) restart

dev-logs: ## Follow logs from all services
	docker compose logs -f

ui-logs: ## Follow logs from the Chat UI only
	docker compose logs -f chat-ui

dev-status: ## Show container health status
	docker compose ps

# ---- Testing -----------------------------------------------

test: test-unit test-policies ## Run fast tests (unit + OPA) — no Docker required

test-all: test-unit test-policies test-integration ## Run all non-eval tests (requires Docker stack)

test-agents: sdk-install ## Run legacy agent service unit tests
	@echo "→ Installing agent dependencies..."
	$(PIP) install -r agents/requirements.txt --quiet
	@echo "→ Running agent tests..."
	cd agents && $(REPO_ROOT)/$(PYTEST) tests/ -v --tb=short

test-mcp: sdk-install ## Run all MCP server unit tests
	@echo "→ Installing MCP dependencies..."
	$(PIP) install -r tools/data-mcp/requirements.txt --quiet
	$(PIP) install -r tools/salesforce-mcp/requirements.txt --quiet 2>/dev/null || true
	$(PIP) install -r tools/payments-mcp/requirements.txt --quiet 2>/dev/null || true
	$(PIP) install -r tools/news-search-mcp/requirements.txt --quiet 2>/dev/null || true
	@echo "→ Running data-mcp tests..."
	cd tools/data-mcp && $(REPO_ROOT)/$(PYTEST) tests/ -v --tb=short
	@echo "→ Running salesforce-mcp tests..."
	cd tools/salesforce-mcp && $(REPO_ROOT)/$(PYTEST) tests/ -v --tb=short
	@echo "→ Running payments-mcp tests..."
	cd tools/payments-mcp && $(REPO_ROOT)/$(PYTEST) tests/ -v --tb=short
	@echo "→ Running news-search-mcp tests..."
	cd tools/news-search-mcp && $(REPO_ROOT)/$(PYTEST) tests/ -v --tb=short

test-unit: sdk-install ## Run Layer 1 unit tests (auth, cache, brief rendering — no Docker)
	@echo "→ Installing test + agent dependencies..."
	$(PIP) install -r tests/requirements.txt --quiet
	$(PIP) install -r agents/rm-prep/requirements.txt --quiet
	@echo "→ Running unit tests..."
	$(PYTEST) tests/unit/ -m unit -v --tb=short --color=yes

test-integration: sdk-install ## Run Layer 2 integration tests (requires dev-test-up stack)
	@echo "→ Installing test dependencies..."
	$(PIP) install -r tests/requirements.txt --quiet
	@echo "→ Running integration tests..."
	@echo "   (requires 'make dev-test-up' first)"
	$(PYTEST) tests/integration/ -m integration -v --tb=short --color=yes \
	  --timeout=60

test-evals: sdk-install ## Run Layer 3 LLM-in-the-loop evals (requires full stack + LLM creds)
	@echo "→ Installing test dependencies..."
	$(PIP) install -r tests/requirements.txt --quiet
	$(PIP) install -r agents/rm-prep/requirements.txt --quiet
	@echo "→ Running eval tests..."
	@echo "   (requires 'make dev-test-up' + LLM credentials)"
	$(PYTEST) tests/evals/ -m "eval and slow" -v --tb=short --color=yes \
	  --timeout=300

test-evals-fidelity: sdk-install ## Run specialist fidelity evals only (faster)
	$(PIP) install -r tests/requirements.txt --quiet
	$(PIP) install -r agents/rm-prep/requirements.txt --quiet
	$(PYTEST) tests/evals/test_specialist_fidelity.py -m eval -v --tb=short --timeout=120

test-evals-synthesis: sdk-install ## Run synthesis quality evals only
	$(PIP) install -r tests/requirements.txt --quiet
	$(PYTEST) tests/evals/test_synthesis_quality.py -m eval -v --tb=short --timeout=300

test-evals-faithfulness: sdk-install ## Run RAGAS faithfulness evals only (hallucination detection)
	$(PIP) install -r tests/requirements.txt --quiet
	$(PYTEST) tests/evals/test_faithfulness.py -m "eval and slow" -v --tb=short --timeout=300

test-policies: ## Run OPA policy unit tests
	@echo "→ Running OPA policy tests..."
	opa test tools/policies/opa/ -v

# ---- Code Quality ------------------------------------------

lint: sdk-install ## Run ruff linter across all Python services
	$(PYTHON) -m ruff check agents/src/ tools/data-mcp/src/ platform-sdk/platform_sdk/

format: sdk-install ## Auto-format all Python source
	$(PYTHON) -m ruff format agents/src/ tools/data-mcp/src/ platform-sdk/platform_sdk/

# ---- SDK ---------------------------------------------------

sdk-install: $(VENV)/bin/python3 ## Create venv (if needed) and install platform-sdk
	$(PIP) install -e platform-sdk/ --quiet
	@echo "✅ SDK installed. Activate manually with: source .venv/bin/activate"

# ---- Docker Builds (from monorepo root) --------------------

build: ## Build all Docker images
	docker build -f agents/Dockerfile -t enterprise-ai/ai-agents:local .
	docker build -f tools/data-mcp/Dockerfile -t enterprise-ai/data-mcp:local .

# ---- Kubernetes (Skaffold) ---------------------------------

k8s-dev: ## Deploy to dev Kubernetes cluster
	skaffold run --profile=dev-cluster

k8s-prod: ## Deploy to production Kubernetes cluster
	skaffold run --profile=production

k8s-down: ## Delete Kubernetes deployments
	skaffold delete --profile=dev-cluster

# ---- Cleanup -----------------------------------------------

clean: ## Remove Python caches, build artifacts, and the venv
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "dist" -exec rm -rf {} + 2>/dev/null || true
	rm -rf $(VENV)
	@echo "✅ Cleaned (run 'make sdk-install' to recreate the venv)"
