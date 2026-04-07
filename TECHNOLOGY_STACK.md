# Technology Stack

This document describes every major framework, library, and third-party service used in the Enterprise AI platform, organized by architectural layer. The most important technologies in each layer are listed first.

---

## Backend — Agent Services & MCP Tool Servers

The backend is written in **object-oriented Python 3.11+** throughout. All services share a common structure: a FastAPI HTTP layer on top of async business logic, communicating via MCP over SSE.

| Technology | Purpose | More Information |
|---|---|---|
| **Python 3.11+** | Primary implementation language. The codebase uses modern Python features: dataclasses, `asyncio`, type hints, and protocol-based dependency injection throughout all services and the platform SDK. | https://www.python.org |
| **LangGraph** | Agent orchestration framework. All agents use LangGraph `StateGraph` to define multi-step ReAct tool-call loops with typed state, conditional edges, and checkpointing. Both the generic chat agent and analytics agent are built as LangGraph graphs. | https://langchain-ai.github.io/langgraph |
| **FastAPI** | HTTP API framework for all agent service endpoints (`/chat`, `/health`, streaming responses). Chosen for its native async support, automatic OpenAPI docs, and Pydantic integration. | https://fastapi.tiangolo.com |
| **MCP (Model Context Protocol)** | Protocol and SDK for building tool servers that agents call. Each data source (SQL, CRM, payments, news) is wrapped as an MCP server that agents discover and invoke at runtime. Uses SSE transport for streaming tool results. | https://modelcontextprotocol.io |
| **LangChain** | LLM abstraction and tooling layer used alongside LangGraph. Provides `ChatOpenAI` wrappers, tool schemas, and chain primitives consumed by the LangGraph orchestration logic. | https://python.langchain.com |
| **Pydantic v2** | Data validation and typed configuration. Used for request/response models in FastAPI, structured agent outputs (`RMBrief`), and environment-driven config objects (`AgentConfig`, `MCPConfig`). | https://docs.pydantic.dev |
| **Uvicorn** | ASGI server that runs FastAPI services inside Docker containers. Used with the `standard` extras (watchfiles, httptools) for production-grade async serving. | https://www.uvicorn.org |
| **asyncpg** | High-performance async PostgreSQL driver. Used by MCP servers (data-mcp, salesforce-mcp, payments-mcp) for all database queries, and by the Chainlit data layer for conversation persistence. | https://magicstack.github.io/asyncpg |
| **SQLAlchemy 2** | ORM used specifically by the Chainlit data layer (`SQLAlchemyDataLayer`) to persist conversation threads and messages in PostgreSQL. | https://www.sqlalchemy.org |
| **httpx** | Async HTTP client. Used by `OpaClient` in the platform SDK to call the OPA REST API for authorization decisions, and in integration/eval test suites. | https://www.python-httpx.org |
| **Redis (redis-py async)** | Tool-result cache and rate-limit store. The `ToolResultCache` in the platform SDK stores MCP tool outputs in Redis with configurable TTLs, reducing repeated data-source queries. Also used by LiteLLM for semantic caching. | https://redis-py.readthedocs.io |
| **Jinja2** | Prompt templating engine. The `PromptLoader` in the platform SDK renders agent system prompts from Jinja2 templates, with sandboxed execution to prevent server-side template injection (SSTI). | https://jinja.palletsprojects.com |
| **tiktoken** | Token counter from OpenAI. Used by the compaction module in the platform SDK to measure conversation length in tokens before deciding whether to summarize. | https://github.com/openai/tiktoken |
| **structlog** | Structured JSON logging library. All services emit structured log events with consistent fields (service name, trace ID, request ID) instead of free-form text logs. | https://www.structlog.org |
| **Tavily Python** | Search API client for the `news-search-mcp` server. Provides real-time company news retrieval; falls back to mock data when no API key is configured. | https://tavily.com |
| **SSE Starlette** | Server-Sent Events support for FastAPI. Used by the analytics agent to stream intermediate results back to the dashboard frontend. | https://github.com/sysid/sse-starlette |
| **PyJWT** | JWT encoding and decoding. Used in test suites to generate signed tokens for authenticated API calls against the running Docker stack. | https://pyjwt.readthedocs.io |

---

## LLM Layer — Model Routing, Observability & Evaluation

| Technology | Purpose | More Information |
|---|---|---|
| **LiteLLM Proxy** | Unified LLM gateway and router. All agents send requests to LiteLLM rather than directly to the model provider. LiteLLM handles model routing (`complex-routing` → GPT-4o, `fast-routing` → GPT-4o-mini), Redis-backed semantic caching, rate limiting, and OpenTelemetry trace forwarding. This decouples the codebase from any specific provider. | https://litellm.ai |
| **Azure OpenAI** | Model provider. GPT-4o is used for complex synthesis and reasoning tasks; GPT-4o-mini is used for intent routing, specialist data-gathering nodes, and conversation compaction. Accessed exclusively through the LiteLLM proxy. | https://azure.microsoft.com/en-us/products/ai-services/openai-service |
| **LangFuse** | LLM observability and prompt management platform. Receives all traces via the OpenTelemetry Collector (OTLP), providing a UI for inspecting agent runs, token usage, latency, and evaluation scores. Also used to version and retrieve prompt templates at runtime via its SDK. | https://langfuse.com |
| **OpenTelemetry (Python SDK)** | Distributed tracing instrumentation. Every service emits spans to the OTel Collector using the OTLP exporter. Auto-instrumentation is provided by `opentelemetry-instrumentation-fastapi` and `opentelemetry-instrumentation-langchain` (via OpenLLMetry). | https://opentelemetry.io |
| **RAGAS** | LLM evaluation framework used in the eval test layer (`make test-evals`). Measures answer faithfulness, context relevance, and hallucination using an LLM-as-judge pattern. Also used in the continuous embedding pipeline for RAGAS-gated model deployment. | https://docs.ragas.io |
| **OpenAI Python SDK** | Used directly in eval tests as the LLM judge client, and as the underlying transport layer for `langchain-openai` and the platform SDK's LLM calls routed through LiteLLM. | https://platform.openai.com/docs/libraries |

---

## Frontend

The platform has two distinct frontends serving different user personas.

### Analytics Dashboard — Next.js (TypeScript)

| Technology | Purpose | More Information |
|---|---|---|
| **Next.js 15** | Full-stack React framework for the analytics dashboard. Uses the App Router, server components, and API routes to proxy requests to the analytics agent backend. | https://nextjs.org |
| **React 19** | UI component library used throughout the analytics dashboard. | https://react.dev |
| **TypeScript 5** | Static typing for all dashboard source code. | https://www.typescriptlang.org |
| **Tailwind CSS 4** | Utility-first CSS framework for all dashboard styling. | https://tailwindcss.com |
| **Vercel AI SDK (`ai`, `@ai-sdk/react`)** | Streaming chat and AI response handling in the dashboard. Provides `useChat` hooks, streaming text rendering, and structured output helpers that connect React components to the analytics agent backend. | https://sdk.vercel.ai |
| **Radix UI** | Unstyled, accessible headless component primitives. Used for dialogs, tooltips, scroll areas, collapsibles, and avatars throughout the dashboard. | https://www.radix-ui.com |
| **Recharts** | Chart library built on D3. Used to render analytics visualizations (bar charts, line charts, data tables) within the dashboard. | https://recharts.org |
| **Auth0 (`@auth0/nextjs-auth0`)** | OAuth 2.0 / OIDC authentication for the analytics dashboard. Handles login flows, session management, and JWT issuance for calls to the analytics agent. | https://auth0.com |
| **lucide-react** | Icon library used throughout the dashboard UI. | https://lucide.dev |
| **react-markdown + remark-gfm** | Renders agent markdown responses (tables, code blocks, lists) inside chat and result panels. | https://github.com/remarkjs/react-markdown |

### Chat UI — Chainlit (Python)

| Technology | Purpose | More Information |
|---|---|---|
| **Chainlit** | Python-native chat application framework. The `chat-ui` service is a Chainlit app that connects to the agent backend, renders a full chat interface, handles user authentication, and persists conversation threads via its `SQLAlchemyDataLayer`. | https://chainlit.io |

---

## Data & Storage

| Technology | Purpose | More Information |
|---|---|---|
| **PostgreSQL 16 with pgvector** | Primary relational database for all application data. The `pgvector/pgvector:pg16` image adds the `pgvector` extension, enabling vector similarity search alongside standard SQL. Stores CRM accounts, payment records, conversation history, and (via pgvector) embedding vectors. | https://github.com/pgvector/pgvector |
| **Redis 7.2** | In-memory data store used for three distinct purposes: tool-result caching (platform SDK), LiteLLM semantic response caching, and rate-limit counters. Runs in authenticated mode. | https://redis.io |
| **ClickHouse** | Columnar analytics database used internally by LangFuse v3 to store and query trace/observation data at scale. Not accessed directly by application code. | https://clickhouse.com |
| **MinIO** | S3-compatible object storage used internally by LangFuse v3 for event upload storage. Runs as a sidecar to the LangFuse stack. | https://min.io |

---

## ML / Embedding Pipeline

The `services/continuous_embedding_pipeline` service implements a data-flywheel for continuously improving domain-specific embedding models.

| Technology | Purpose | More Information |
|---|---|---|
| **Sentence Transformers** | Base embedding model framework. Provides pre-trained models and the MNRL (Multiple Negatives Ranking Loss) fine-tuning loop for adapting embeddings to the banking domain. | https://www.sbert.net |
| **PyTorch** | Deep learning runtime used by Sentence Transformers for model training and inference. | https://pytorch.org |
| **HuggingFace Datasets** | Dataset loading, hard-negative mining, and evaluation dataset construction for the embedding fine-tuning pipeline. | https://huggingface.co/docs/datasets |
| **pgvector (Python client)** | Python client for the pgvector PostgreSQL extension. Used by the embedding pipeline to store and retrieve embedding vectors for similarity search and hard-negative mining. | https://github.com/pgvector/pgvector-python |
| **dependency-injector** | IoC container used in the embedding pipeline service for wiring together configurable pipeline stages (mining, training, evaluation, deployment). | https://python-dependency-injector.ets-labs.org |

---

## Policy & Security

| Technology | Purpose | More Information |
|---|---|---|
| **Open Policy Agent (OPA)** | Policy-as-code engine for authorization. All MCP tool servers submit authorization requests to OPA before executing any tool call. Policies are written in Rego, version-controlled alongside the application code, and tested with OPA's native test runner (`opa test`). | https://www.openpolicyagent.org |
| **HMAC-signed AgentContext** | Custom security primitive in the platform SDK. Each orchestrator signs an `AgentContext` payload with HMAC-SHA256 before forwarding it to MCP servers as `X-Agent-Context`. Downstream servers verify the signature, preventing context spoofing without forwarding raw user JWTs. | https://docs.python.org/3/library/hmac.html |

---

## Infrastructure & Deployment

| Technology | Purpose | More Information |
|---|---|---|
| **Docker & Docker Compose** | All services are containerized and orchestrated locally with Docker Compose. Two compose files separate long-lived infrastructure (`docker-compose.infra.yml`) from frequently-rebuilt application services (`docker-compose.yml`). | https://docs.docker.com |
| **Docker Desktop for Windows (WSL2)** | Local development runtime on Windows. Docker Desktop runs the container engine via the WSL2 backend, exposing all service ports to both WSL and Windows browsers without additional configuration. | https://docs.docker.com/desktop/windows |
| **OpenTelemetry Collector** | Central telemetry pipeline. Receives OTLP traces from all services and forwards them to LangFuse for LLM observability. Uses the `contrib` distribution for additional exporters and processors. | https://opentelemetry.io/docs/collector |
| **Terraform** | Infrastructure-as-code for Azure cloud provisioning. The `infra/azure/` module provisions an Azure VM, VNet, NSG, and Application Gateway with WAF for production deployments. | https://www.terraform.io |
| **Azure (VM + App Gateway + WAF)** | Cloud deployment target. The platform is deployed to a single Azure VM behind an Application Gateway with Web Application Firewall enabled for production workloads. | https://azure.microsoft.com |
| **GitHub Actions** | CI/CD pipeline with four workflows: `ci-unit.yml` (unit tests + OPA policy tests), `ci-integration.yml` (full Docker stack integration tests), `ci-evals.yml` (LLM-in-the-loop evals), and `ci-deploy.yml` (Azure VM deployment via rsync). | https://docs.github.com/en/actions |

---

## Build, Tooling & Testing

| Technology | Purpose | More Information |
|---|---|---|
| **Make** | Task runner and developer interface. A single root `Makefile` provides all commands for infrastructure management, development lifecycle, testing, linting, and cloud deployment (`make infra-up`, `make dev-test-up`, `make test`, etc.). | https://www.gnu.org/software/make |
| **pytest** | Python test framework used across all layers. A single root `pyproject.toml` configures pytest to collect tests from all service directories in one pass. Test markers (`unit`, `integration`, `eval`, `slow`) control which tests run in each CI job. | https://pytest.org |
| **pytest-asyncio** | pytest plugin for testing `async` functions and fixtures without manual event loop management. All async test functions use `asyncio_mode = "auto"`. | https://pytest-asyncio.readthedocs.io |
| **pytest-cov** | Code coverage measurement. Coverage is collected across `platform_sdk`, `agents`, and `tools` packages with a minimum threshold enforced in CI. | https://pytest-cov.readthedocs.io |
| **Ruff** | Python linter and formatter. Replaces flake8, isort, and black in a single fast tool. A single `[tool.ruff]` config in the root `pyproject.toml` applies consistently across the entire monorepo. | https://docs.astral.sh/ruff |
| **setuptools** | Python packaging backend for the `platform-sdk` package, enabling editable installs (`make sdk-install`) that share one copy of the SDK code across all services during local development. | https://setuptools.pypa.io |
