# Analytics Dashboard

Next.js 15 + Shadcn/ui + Vercel AI SDK + Recharts frontend for the Enterprise Agentic Analytics Platform.

## Tech Stack

- **Framework:** Next.js 15 (App Router, standalone output)
- **UI Components:** Shadcn/ui (Radix primitives + Tailwind CSS)
- **Styling:** Tailwind CSS v4 (dark theme)
- **Streaming:** Vercel AI SDK v4 (`useChat` with Data Stream Protocol)
- **Charts:** Recharts (Bar, Line, Area, Pie, KPI, DataTable)
- **Markdown:** react-markdown + remark-gfm

## Development

```bash
npm install
npm run dev     # http://localhost:3003
```

The dev server proxies `/api/v1/*` requests to the analytics-agent backend via `next.config.ts` rewrites.

Set `ANALYTICS_AGENT_URL` to override the default backend URL (defaults to `http://analytics-agent:8000` for Docker).

## Docker

```bash
# From the monorepo root:
docker compose up analytics-dashboard
# Open http://localhost:3003
```

## Architecture

- **Backend:** The analytics-agent exposes `POST /api/v1/analytics/chat` emitting the Vercel AI SDK Data Stream Protocol
- **Frontend:** `useChat` from `@ai-sdk/react` handles streaming, message state, and protocol parsing natively
- **UI Components:** Charts, KPIs, and tables arrive as `2:` (data) events and are rendered inline within assistant messages
- **Reasoning:** Intent classification and tool call activity arrive as `g:` (reasoning) tokens and render in collapsible ThinkingBlock components
- **Conversations:** Stored client-side via localStorage, grouped by time in the sidebar
