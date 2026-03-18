# ============================================================
# agents/portfolio-watch/Dockerfile
# Build context: monorepo root
# ============================================================
FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install platform SDK (shared across all agents)
COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

# Install agent-specific dependencies
COPY agents/portfolio-watch/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy agent source and mock data
COPY agents/portfolio-watch/src/      /app/src/
COPY agents/portfolio-watch/mock_data/ /app/mock_data/

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8004

CMD ["uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "8004"]
