# ============================================================
# enterprise-ai — Developer Commands
# ============================================================
.PHONY: help dev-up dev-down dev-restart dev-logs dev-status \
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

dev-up: ## Start the full local stack (builds images if needed)
	@echo "→ Checking for .env file..."
	@test -f .env || (echo "ERROR: .env not found. Run: cp .env.example .env" && exit 1)
	docker compose up --build -d
	@echo ""
	@echo "✅ Local stack is running:"
	@echo "   LiteLLM Proxy  → http://localhost:4000"
	@echo "   Data MCP       → http://localhost:8080"
	@echo "   Agent Service  → http://localhost:8000"
	@echo "   OTel Collector → http://localhost:4318"
	@echo "   PostgreSQL     → localhost:5432"
	@echo ""
	@echo "   Run 'make dev-logs' to follow logs."

dev-down: ## Stop and remove all containers
	docker compose down

dev-restart: ## Restart all containers
	docker compose restart

dev-logs: ## Follow logs from all services
	docker compose logs -f

dev-status: ## Show container health status
	docker compose ps

# ---- Testing -----------------------------------------------

test: test-agents test-mcp test-policies ## Run all tests

test-agents: sdk-install ## Run agent service unit tests
	@echo "→ Installing agent dependencies..."
	$(PIP) install -r agents/requirements.txt --quiet
	@echo "→ Running agent tests..."
	cd agents && $(REPO_ROOT)/$(PYTEST) tests/ -v --tb=short

test-mcp: sdk-install ## Run data-mcp unit tests
	@echo "→ Installing data-mcp dependencies..."
	$(PIP) install -r tools/data-mcp/requirements.txt --quiet
	@echo "→ Running data-mcp tests..."
	cd tools/data-mcp && $(REPO_ROOT)/$(PYTEST) tests/ -v --tb=short

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
