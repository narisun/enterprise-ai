# ── Build stage ────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source and build
COPY . .

# Set build-time env for the API rewrite target
ENV ANALYTICS_AGENT_URL=http://analytics-agent:8000

# Auth0 placeholders for build — the Auth0Client is lazily initialised at
# request time so these are never used, but next build resolves the module
# graph statically and would warn without them.
ENV AUTH0_DOMAIN=placeholder.auth0.com
ENV AUTH0_CLIENT_ID=placeholder
ENV AUTH0_CLIENT_SECRET=placeholder
ENV AUTH0_SECRET=placeholder-secret-at-least-32-bytes-long

RUN npm run build

# ── Runtime stage ──────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV ANALYTICS_AGENT_URL=http://analytics-agent:8000

# Copy standalone output from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

# HOSTNAME must be set inline — Docker overrides ENV HOSTNAME with the container ID at runtime
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 node server.js"]
