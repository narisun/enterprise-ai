# ============================================================
# tools/data-mcp/Dockerfile
# Build context: monorepo root (docker build -f tools/data-mcp/Dockerfile .)
# ============================================================
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install shared SDK first (separate layer for cache efficiency)
COPY platform-sdk/ /platform-sdk/
RUN pip install --no-cache-dir /platform-sdk/

# Install service dependencies
COPY tools/data-mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service source
COPY tools/data-mcp/src/ /app/src/

# Non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

CMD ["python", "src/server.py"]
