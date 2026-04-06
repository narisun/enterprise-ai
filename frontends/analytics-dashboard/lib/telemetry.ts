/**
 * Frontend OpenTelemetry instrumentation for the Analytics Dashboard.
 *
 * Provides lightweight tracing for:
 *   - Chat API request duration (full round-trip)
 *   - Streaming duration (first byte to stream complete)
 *   - UI component render timing (chart/table/KPI hydration)
 *
 * Configuration via environment variables:
 *   NEXT_PUBLIC_OTEL_ENDPOINT — OTLP HTTP endpoint (default: none, traces disabled)
 *   NEXT_PUBLIC_OTEL_SERVICE_NAME — Service name (default: "analytics-dashboard")
 */

import { trace, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";

// Lazy-initialized tracer — avoids import-time side effects
let _tracer: Tracer | null = null;

function getTracer(): Tracer {
  if (!_tracer) {
    _tracer = trace.getTracer("analytics-dashboard", "1.0.0");
  }
  return _tracer;
}

/**
 * Initialize OpenTelemetry with OTLP HTTP exporter.
 * Call once in the app's root layout or entry point.
 * No-ops gracefully if the endpoint is not configured.
 */
export async function initTelemetry(): Promise<void> {
  const endpoint = process.env.NEXT_PUBLIC_OTEL_ENDPOINT;
  if (!endpoint) return; // OTel disabled — no endpoint configured

  try {
    const { WebTracerProvider } = await import("@opentelemetry/sdk-trace-web");
    const { BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { Resource } = await import("@opentelemetry/resources");

    const resource = new Resource({
      "service.name": process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME || "analytics-dashboard",
    });

    const provider = new WebTracerProvider({ resource });
    provider.addSpanProcessor(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
      )
    );
    provider.register();
  } catch {
    // OTel packages not available — silently degrade
    console.warn("[telemetry] OpenTelemetry initialization failed — traces disabled");
  }
}

/** Trace a chat API request (full round-trip). */
export function traceChatRequest(sessionId: string): {
  end: (status?: "ok" | "error", errorMessage?: string) => void;
} {
  const span = getTracer().startSpan("chat.request", {
    attributes: { "chat.session_id": sessionId },
  });

  return {
    end(status = "ok", errorMessage?: string) {
      if (status === "error") {
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
    },
  };
}

/** Trace streaming duration (first token to completion). */
export function traceStream(sessionId: string): {
  onFirstToken: () => void;
  onComponent: (componentType: string) => void;
  end: (tokenCount?: number) => void;
} {
  const span = getTracer().startSpan("chat.stream", {
    attributes: { "chat.session_id": sessionId },
  });
  let firstTokenTime: number | null = null;

  return {
    onFirstToken() {
      firstTokenTime = performance.now();
      span.addEvent("first_token");
    },
    onComponent(componentType: string) {
      span.addEvent("ui_component_received", { "component.type": componentType });
    },
    end(tokenCount?: number) {
      if (firstTokenTime) {
        span.setAttribute("stream.first_token_ms", firstTokenTime);
      }
      if (tokenCount !== undefined) {
        span.setAttribute("stream.token_count", tokenCount);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    },
  };
}

/** Trace a UI component render (mount to paint). */
export function traceComponentRender(
  componentType: string,
  dataPointCount: number
): { end: () => void } {
  const span = getTracer().startSpan("ui.component_render", {
    attributes: {
      "component.type": componentType,
      "component.data_points": dataPointCount,
    },
  });

  return {
    end() {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    },
  };
}
