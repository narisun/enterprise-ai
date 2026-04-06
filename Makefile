# ============================================================
# enterprise-ai — Developer Commands
# ============================================================
.PHONY: help dev-up dev-test-up dev-down dev-reset dev-restart dev-logs dev-status \
        test test-unit test-agents test-mcp test-policies \
        test-integration test-evals test-evals-fidelity test-evals-synthesis \
        test-evals-faithfulness test-all test-all-unit \
        lint lint-fix format build sdk-install install-all-deps \
        k8s-dev k8s-prod k8s-down \
        tf-bootstrap tf-vpc tf-ecr tf-iam tf-eks tf-elasticache tf-rds \
        tf-plan-all aws-secrets aws-connect aws-status \
        clean

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
	  awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ---- Local Development (Docker Compose) --------------------

# Both compose files used consistently everywhere — prevents partial stack
# scenarios where services defined in the test overlay are missed.
COMPOSE_BASE := docker compose -f docker-compose.yml
COMPOSE_TEST := docker compose -f docker-compose.yml -f docker-compose.test.yml

dev-up: ## Start the stack without test fixtures (prod-schema only)
	@echo "→ Checking for .env file..."
	@test -f .env || (echo "ERROR: .env not found. Run: cp .env.example .env" && exit 1)
	$(COMPOSE_BASE) up --build -d
	@echo ""
	@echo "✅ Local stack is running (no test fixtures — salesforce/bankdw schemas absent)."
	@echo "   Use 'make dev-test-up' to include Salesforce + bankdw test data."
	@echo ""
	@echo "   🌐 Chat UI        → http://localhost:8501"
	@echo "   🤖 Agent API      → http://localhost:8000"
	@echo "   📊 Analytics UI   → http://localhost:3002"
	@echo "   📈 Analytics API  → http://localhost:8086"
	@echo "   🔀 LiteLLM Proxy  → http://localhost:4000"
	@echo "   🛠  Data MCP       → http://localhost:8080"
	@echo "   📡 OTel Collector  → http://localhost:4318"
	@echo "   📊 LangFuse       → http://localhost:3001"
	@echo "   🗄  PostgreSQL     → localhost:5432"
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
	@echo "   🌐 Chat UI        → http://localhost:8501  (SHOW_TEST_LOGIN=true)"
	@echo "   🤖 Agent API      → http://localhost:8000"
	@echo "   📊 Analytics UI   → http://localhost:3002"
	@echo "   📈 Analytics API  → http://localhost:8086"
	@echo "   🔀 LiteLLM Proxy  → http://localhost:4000"
	@echo "   🛠  Data MCP       → http://localhost:8080"
	@echo "   📡 OTel Collector  → http://localhost:4318"
	@echo "   📊 LangFuse       → http://localhost:3001"
	@echo "   🗄  PostgreSQL     → localhost:5432"
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

# Explicitly specify compose files so test-overlay service logs are always included.
dev-logs: ## Follow logs from all services
	$(COMPOSE_TEST) logs -f

ui-logs: ## Follow logs from the Chat UI only
	$(COMPOSE_TEST) logs -f chat-ui

dev-status: ## Show container health status
	$(COMPOSE_TEST) ps

# ---- Dependency Installation ----------------------------------------

sdk-install: $(VENV)/bin/python3 ## Create venv (if needed) and install platform-sdk
	$(PIP) install -e platform-sdk/ --quiet
	@echo "✅ SDK installed. Activate manually with: source .venv/bin/activate"

install-all-deps: sdk-install ## Install ALL service + test dependencies (needed for test-all-unit)
	@echo "→ Installing test framework + root test deps..."
	$(PIP) install -r tests/requirements.txt --quiet
	@echo "→ Installing agents deps..."
	$(PIP) install -r agents/requirements.txt \
	               -r agents/requirements-test.txt --quiet
	@echo "→ Installing agents/rm-prep deps..."
	$(PIP) install -r agents/rm-prep/requirements.txt \
	               -r agents/rm-prep/requirements-test.txt --quiet
	@echo "→ Installing agents/analytics-agent deps..."
	$(PIP) install -r agents/analytics-agent/requirements.txt --quiet
	@echo "→ Installing data-mcp deps..."
	$(PIP) install -r tools/data-mcp/requirements.txt \
	               -r tools/data-mcp/requirements-test.txt --quiet
	@echo "→ Installing salesforce-mcp deps..."
	$(PIP) install -r tools/salesforce-mcp/requirements.txt \
	               -r tools/salesforce-mcp/requirements-test.txt --quiet 2>/dev/null || true
	@echo "→ Installing payments-mcp deps..."
	$(PIP) install -r tools/payments-mcp/requirements.txt \
	               -r tools/payments-mcp/requirements-test.txt --quiet 2>/dev/null || true
	@echo "→ Installing news-search-mcp deps..."
	$(PIP) install -r tools/news-search-mcp/requirements.txt \
	               -r tools/news-search-mcp/requirements-test.txt --quiet 2>/dev/null || true
	@echo "✅ All deps installed."

# ---- Testing -----------------------------------------------

test: test-unit test-policies ## Run fast tests (unit + OPA) — no Docker required

test-all: test-unit test-policies test-integration ## Run all non-eval tests (requires Docker stack)

# Single pytest invocation from the repo root covering every service.
# pyproject.toml testpaths = [tests, agents/tests, tools/*/tests]
test-all-unit: install-all-deps ## Run ALL unit tests across every service in one shot (no Docker needed)
	@echo "→ Running all monorepo unit tests..."
	@mkdir -p test-results
	$(PYTEST) -m "not integration and not eval" \
	  -v --tb=short --color=yes \
	  --junit-xml=test-results/all-unit.xml \
	  --cov=platform_sdk \
	  --cov=agents/src \
	  --cov=agents/rm-prep/src \
	  --cov=tools/data-mcp/src \
	  --cov=tools/payments-mcp/src \
	  --cov=tools/salesforce-mcp/src \
	  --cov=tools/news-search-mcp/src \
	  --cov-report=term-missing \
	  --cov-report=xml:test-results/coverage.xml

test-unit: sdk-install ## Run Layer 1 unit tests (auth, cache, brief rendering — no Docker)
	@echo "→ Installing test + agent dependencies..."
	$(PIP) install -r tests/requirements.txt --quiet
	$(PIP) install -r agents/rm-prep/requirements.txt \
	               -r agents/rm-prep/requirements-test.txt --quiet
	@echo "→ Running unit tests..."
	@mkdir -p test-results
	$(PYTEST) tests/unit/ -m unit -v --tb=short --color=yes \
	  --junit-xml=test-results/unit.xml

test-agents: sdk-install ## Run agent service unit tests
	@echo "→ Installing agent dependencies..."
	$(PIP) install -r agents/requirements.txt \
	               -r agents/requirements-test.txt --quiet
	@echo "→ Running agent tests..."
	@mkdir -p test-results
	$(PYTEST) agents/tests/ -v --tb=short --color=yes \
	  --junit-xml=test-results/agents.xml

test-mcp: sdk-install ## Run all MCP server unit tests
	@echo "→ Installing MCP dependencies..."
	$(PIP) install -r tools/data-mcp/requirements.txt \
	               -r tools/data-mcp/requirements-test.txt --quiet
	$(PIP) install -r tools/salesforce-mcp/requirements.txt \
	               -r tools/salesforce-mcp/requirements-test.txt --quiet 2>/dev/null || true
	$(PIP) install -r tools/payments-mcp/requirements.txt \
	               -r tools/payments-mcp/requirements-test.txt --quiet 2>/dev/null || true
	$(PIP) install -r tools/news-search-mcp/requirements.txt \
	               -r tools/news-search-mcp/requirements-test.txt --quiet 2>/dev/null || true
	@echo "→ Running all MCP server tests..."
	@mkdir -p test-results
	$(PYTEST) tools/data-mcp/tests/ \
	          tools/salesforce-mcp/tests/ \
	          tools/payments-mcp/tests/ \
	          tools/news-search-mcp/tests/ \
	  -v --tb=short --color=yes \
	  --junit-xml=test-results/mcp.xml

test-integration: sdk-install ## Run Layer 2 integration tests (requires dev-test-up stack)
	@echo "→ Installing test dependencies..."
	$(PIP) install -r tests/requirements.txt --quiet
	@echo "→ Running integration tests..."
	@echo "   (requires 'make dev-test-up' first)"
	@mkdir -p test-results
	$(PYTEST) tests/integration/ -m integration -v --tb=short --color=yes \
	  --timeout=60 \
	  --junit-xml=test-results/integration.xml

test-evals: sdk-install ## Run Layer 3 LLM-in-the-loop evals (requires full stack + LLM creds)
	@echo "→ Installing test dependencies..."
	$(PIP) install -r tests/requirements.txt --quiet
	$(PIP) install -r agents/rm-prep/requirements.txt \
	               -r agents/rm-prep/requirements-test.txt --quiet
	@echo "→ Running eval tests..."
	@echo "   (requires 'make dev-test-up' + LLM credentials)"
	@mkdir -p test-results
	$(PYTEST) tests/evals/ -m "eval and slow" -v --tb=short --color=yes \
	  --timeout=300 \
	  --junit-xml=test-results/evals.xml

test-evals-fidelity: sdk-install ## Run specialist fidelity evals only (faster)
	$(PIP) install -r tests/requirements.txt --quiet
	$(PIP) install -r agents/rm-prep/requirements.txt \
	               -r agents/rm-prep/requirements-test.txt --quiet
	@mkdir -p test-results
	$(PYTEST) tests/evals/test_specialist_fidelity.py -m eval -v --tb=short --timeout=120 \
	  --junit-xml=test-results/evals-fidelity.xml

test-evals-synthesis: sdk-install ## Run synthesis quality evals only
	$(PIP) install -r tests/requirements.txt --quiet
	@mkdir -p test-results
	$(PYTEST) tests/evals/test_synthesis_quality.py -m eval -v --tb=short --timeout=300 \
	  --junit-xml=test-results/evals-synthesis.xml

test-evals-faithfulness: sdk-install ## Run RAGAS faithfulness evals only (hallucination detection)
	$(PIP) install -r tests/requirements.txt --quiet
	@mkdir -p test-results
	$(PYTEST) tests/evals/test_faithfulness.py -m "eval and slow" -v --tb=short --timeout=300 \
	  --junit-xml=test-results/evals-faithfulness.xml

test-policies: ## Run OPA policy unit tests
	@echo "→ Running OPA policy tests..."
	opa test tools/policies/opa/ -v

# ---- Code Quality ------------------------------------------

# Both lint and format target `.` — pyproject.toml [tool.ruff] defines what
# to check/exclude, so Makefile and CI always scan identical code.
lint: sdk-install ## Run ruff linter across the entire monorepo
	$(PYTHON) -m ruff check .

lint-fix: sdk-install ## Auto-fix ruff lint issues
	$(PYTHON) -m ruff check . --fix

format: sdk-install ## Auto-format all Python source
	$(PYTHON) -m ruff format .

# ---- Docker Builds (from monorepo root) --------------------

build: ## Build all Docker images
	docker build -f agents/Dockerfile -t enterprise-ai/ai-agents:local .
	docker build -f agents/rm-prep/Dockerfile -t enterprise-ai/rm-prep-agent:local .
	docker build -f agents/analytics-agent/Dockerfile -t enterprise-ai/analytics-agent:local .
	docker build -f tools/data-mcp/Dockerfile -t enterprise-ai/data-mcp:local .

test-analytics: sdk-install ## Run analytics-agent unit tests
	@echo "→ Installing analytics-agent dependencies..."
	$(PIP) install -r agents/analytics-agent/requirements.txt --quiet
	@echo "→ Running analytics-agent tests..."
	@mkdir -p test-results
	$(PYTEST) agents/analytics-agent/tests/ -v --tb=short --color=yes \
	  --junit-xml=test-results/analytics-agent.xml

analytics-logs: ## Follow logs from analytics services only
	$(COMPOSE_TEST) logs -f analytics-agent analytics-ui analytics-dashboard

# ---- Kubernetes (Skaffold) ---------------------------------

k8s-dev: ## Deploy to dev Kubernetes cluster
	skaffold run --profile=dev-cluster

k8s-prod: ## Deploy to production Kubernetes cluster
	skaffold run --profile=production

k8s-down: ## Delete Kubernetes deployments
	skaffold delete --profile=dev-cluster

# ---- AWS Infrastructure (Terraform) -------------------------
# ENV controls which .tfvars file is used: make tf-vpc ENV=prod
ENV ?= dev

tf-bootstrap: ## (Run ONCE) Create S3 state bucket + DynamoDB lock table, then patch all backend.tf files
	@echo "→ Bootstrapping Terraform remote state..."
	cd infra/terraform/bootstrap && \
	  terraform init && \
	  terraform apply
	@echo "→ Patching all backend.tf files with the actual bucket name..."
	bash infra/terraform/configure-backends.sh
	@echo ""
	@echo "✅ Bootstrap complete. Bucket name patched into all backend.tf files."
	@echo "   Next step: make tf-vpc ENV=$(ENV)"

tf-vpc: ## Apply VPC module (creates subnets, NAT, VPC endpoints)
	@echo "→ Applying VPC for ENV=$(ENV)..."
	cd infra/terraform/vpc && \
	  terraform init && \
	  terraform apply -var-file="environments/$(ENV).tfvars"
	@echo "✅ VPC ready. Outputs:"
	@cd infra/terraform/vpc && terraform output

tf-ecr: ## Apply ECR module (creates container registries — global, run once)
	@echo "→ Applying ECR repositories..."
	cd infra/terraform/ecr && \
	  terraform init && \
	  terraform apply
	@echo "✅ ECR repos ready:"
	@cd infra/terraform/ecr && terraform output repository_urls

tf-iam: ## Apply IAM module (GitHub OIDC + deploy role). Set GITHUB_ORG and GITHUB_REPO.
	@echo "→ Applying IAM for GitHub OIDC..."
	@test -n "$(GITHUB_ORG)"  || (echo "ERROR: set GITHUB_ORG=your-org" && exit 1)
	@test -n "$(GITHUB_REPO)" || (echo "ERROR: set GITHUB_REPO=your-repo" && exit 1)
	cd infra/terraform/iam && \
	  terraform init && \
	  terraform apply \
	    -var="github_org=$(GITHUB_ORG)" \
	    -var="github_repo=$(GITHUB_REPO)"
	@echo "✅ IAM ready. Copy this to GitHub repo variables:"
	@cd infra/terraform/iam && terraform output github_deploy_role_arn

tf-eks: ## Apply EKS module (cluster + nodes + AWS Load Balancer Controller)
	@echo "→ Applying EKS cluster for ENV=$(ENV)..."
	@echo "   ⚠️  This takes 12-15 minutes on first apply."
	cd infra/terraform/eks && \
	  terraform init && \
	  terraform apply -var-file="environments/$(ENV).tfvars"
	@echo "✅ EKS ready. Configuring kubectl..."
	@cd infra/terraform/eks && eval $$(terraform output -raw configure_kubectl)
	@kubectl get nodes

tf-elasticache: ## Apply ElastiCache (Redis) module
	@test -n "$(REDIS_SECRET_ARN)" || (echo "ERROR: set REDIS_SECRET_ARN" && exit 1)
	@echo "→ Applying ElastiCache for ENV=$(ENV)..."
	cd infra/terraform/elasticache && \
	  terraform init && \
	  terraform apply \
	    -var-file="environments/$(ENV).tfvars" \
	    -var="redis_password_secret_arn=$(REDIS_SECRET_ARN)"
	@cd infra/terraform/elasticache && terraform output

tf-rds: ## Apply RDS (PostgreSQL + pgvector) module
	@test -n "$(DB_SECRET_ARN)" || (echo "ERROR: set DB_SECRET_ARN" && exit 1)
	@echo "→ Applying RDS for ENV=$(ENV)..."
	cd infra/terraform/rds && \
	  terraform init && \
	  terraform apply \
	    -var-file="environments/$(ENV).tfvars" \
	    -var="db_password_secret_arn=$(DB_SECRET_ARN)" \
	    -var="vpc_id=$(shell cd infra/terraform/vpc && terraform output -raw vpc_id)" \
	    -var='private_subnet_ids=$(shell cd infra/terraform/vpc && terraform output -json private_subnet_ids)' \
	    -var='allowed_cidr_blocks=$(shell cd infra/terraform/vpc && terraform output -json private_subnet_cidr_blocks)'

tf-plan-all: ## Show plan for all modules without applying (ENV=dev|prod)
	@echo "=== VPC ===" && cd infra/terraform/vpc && terraform init -backend=false -reconfigure 2>/dev/null && terraform plan -var-file="environments/$(ENV).tfvars" -compact-warnings 2>/dev/null || true
	@echo "=== EKS ===" && cd infra/terraform/eks && terraform init -backend=false -reconfigure 2>/dev/null && terraform plan -var-file="environments/$(ENV).tfvars" -compact-warnings 2>/dev/null || true

# ---- AWS Operational Commands ------------------------------

aws-connect: ## Configure kubectl for the EKS cluster (ENV=dev|prod)
	@echo "→ Connecting kubectl to enterprise-ai-$(ENV)..."
	aws eks update-kubeconfig \
	  --name "enterprise-ai-$(ENV)" \
	  --region "$$(cd infra/terraform/eks && terraform output -raw cluster_endpoint 2>/dev/null | cut -d. -f4 || echo us-east-1)"
	@kubectl get nodes

aws-status: ## Show pod and service status in the ai-platform namespace
	@echo "=== Pods ==="
	kubectl get pods -n ai-platform -o wide
	@echo ""
	@echo "=== Services ==="
	kubectl get svc -n ai-platform
	@echo ""
	@echo "=== Ingress ==="
	kubectl get ingress -n ai-platform
	@echo ""
	@echo "=== HPA ==="
	kubectl get hpa -n ai-platform

aws-secrets: ## Create all Secrets Manager entries (interactive — prompts for values)
	@echo "→ Creating AWS Secrets Manager entries for ENV=$(ENV)..."
	@echo "   (You will be prompted for each secret value)"
	@bash infra/k8s/secrets/create-secrets.sh "$(ENV)"

# ---- Cleanup -----------------------------------------------

clean: ## Remove Python caches, build artifacts, venv, and test-results
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "dist" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	rm -rf $(VENV)
	rm -rf test-results/
	@echo "✅ Cleaned (run 'make sdk-install' to recreate the venv)"
