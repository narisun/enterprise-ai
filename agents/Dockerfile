# ============================================================
# agents/Dockerfile
# Build context: monorepo root (docker build -f agents/Dockerfile .)
# This allows COPY from platform-sdk/ AND agents/ in one build.
# ============================================================
FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ---- Install shared SDK first (separate layer for cache efficiency) ----
COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

# ---- Install service dependencies ----
COPY agents/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---- Copy service source ----
COPY agents/src/ /app/src/

# ---- Non-root user for security ----
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "8000"]
