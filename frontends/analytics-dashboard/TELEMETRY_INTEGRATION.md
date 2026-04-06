# Frontend OpenTelemetry Integration

## Overview

Core OpenTelemetry instrumentation has been implemented for the Analytics Dashboard with minimal, targeted changes to existing components. The implementation provides three key traces:

1. **Chat Request Tracing** — Full round-trip duration from user message submission to streaming completion
2. **Streaming Duration** — First token arrival to stream completion, with component event tracking
3. **Component Render Timing** — Chart/table/KPI mount to paint duration

## Files Created

### 1. `lib/telemetry.ts`
Core OpenTelemetry module with three exported tracing functions:

- `initTelemetry()` — Initializes OTLP HTTP exporter (async, gracefully degrades if endpoint not configured)
- `traceChatRequest(sessionId)` — Returns `{end()}` for round-trip tracing
- `traceStream(sessionId)` — Returns `{onFirstToken(), onComponent(type), end(tokenCount)}` for streaming lifecycle
- `traceComponentRender(type, dataPointCount)` — Returns `{end()}` for render timing

**Configuration:**
- `NEXT_PUBLIC_OTEL_ENDPOINT` — OTLP HTTP endpoint (e.g., `http://localhost:4318`). If unset, tracing is silently disabled.
- `NEXT_PUBLIC_OTEL_SERVICE_NAME` — Service name (default: `analytics-dashboard`)

### 2. `components/telemetry/TelemetryProvider.tsx`
Client component that initializes OpenTelemetry on app mount. Wraps the app in `layout.tsx` to ensure tracing is set up before user interaction.

## Files Modified

### 1. `app/layout.tsx`
- Added import: `TelemetryProvider`
- Wrapped app children with `<TelemetryProvider>` to initialize tracing on app startup

### 2. `components/chat/ChatContainer.tsx`
**Streaming request tracing:**
- Added refs to hold chat request and stream trace instances
- When `status` transitions to `"streaming"`: Initialize `traceChatRequest()` and `traceStream()`
- When components arrive: Call `onFirstToken()` on first component, then `onComponent()` for each new component
- When `status` transitions away from `"streaming"`: Call `end()` on both traces with component count

**Integration points:**
- Hook 1: Detects streaming start and initializes traces
- Hook 2: Tracks first token arrival and component events via `onFirstToken()` and `onComponent()`
- Hook 3: Ends traces and closes the streaming span on completion

### 3. `components/charts/ChartRenderer.tsx`
**Component render timing:**
- Added `useEffect` that runs on component mount with data
- Calls `traceComponentRender(componentType, dataPointCount)` and ends trace after next frame (via `requestAnimationFrame`)
- Properly cleans up timer on unmount

## Tracing Behavior

### Chat Request Span
- **Name:** `chat.request`
- **Attributes:** `chat.session_id`
- **Lifecycle:** Started when streaming begins → Ended when streaming completes
- **Status:** OK or ERROR

### Stream Span
- **Name:** `chat.stream`
- **Attributes:** `chat.session_id`
- **Events:**
  - `first_token` — Emitted when first component arrives
  - `ui_component_received` (with `component.type`) — Emitted for each new component
- **Attributes on end:** `stream.first_token_ms`, `stream.token_count`
- **Status:** OK

### Component Render Span
- **Name:** `ui.component_render`
- **Attributes:** `component.type`, `component.data_points`
- **Duration:** From mount to next animation frame
- **Status:** OK

## Environment Setup

To enable tracing, add to `.env.local` or deployment environment:

```env
NEXT_PUBLIC_OTEL_ENDPOINT=http://localhost:4318
NEXT_PUBLIC_OTEL_SERVICE_NAME=analytics-dashboard
```

If not set, tracing silently disables and no spans are exported.

## Dependencies

The implementation uses OpenTelemetry's public API (`@opentelemetry/api`), which is already installed. If OTel SDK packages are missing at runtime, initialization gracefully degrades with a console warning.

Required packages for full functionality:
- `@opentelemetry/api` (API only)
- `@opentelemetry/sdk-trace-web` (optional, for full tracing)
- `@opentelemetry/sdk-trace-base` (optional, for span processors)
- `@opentelemetry/exporter-trace-otlp-http` (optional, for OTLP export)
- `@opentelemetry/resources` (optional, for resource attributes)

## Testing

1. Set `NEXT_PUBLIC_OTEL_ENDPOINT` to a local OTLP receiver (e.g., Jaeger on `http://localhost:4318`)
2. Start the app: `npm run dev`
3. Send a chat message and observe the streams in your OTLP backend
4. Verify three span types:
   - `chat.request` — Full round-trip
   - `chat.stream` — Streaming with component events
   - `ui.component_render` — Per component, once per chart/table/KPI

## No Breaking Changes

All modifications are additive and non-breaking:
- Existing component logic is unchanged
- Tracing runs independently of chat/chart functionality
- If OTel is not configured, the app works identically to before
