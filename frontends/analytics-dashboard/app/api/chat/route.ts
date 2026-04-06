/**
 * Streaming proxy to the analytics-agent backend.
 *
 * Next.js rewrites() buffer full responses, breaking SSE/streaming.
 * This route handler pipes the agent response as a ReadableStream,
 * preserving real-time token delivery for the Data Stream Protocol.
 */

const AGENT_URL = process.env.ANALYTICS_AGENT_URL || "http://analytics-agent:8000";
const REQUEST_TIMEOUT_MS = 120_000;

export async function POST(req: Request) {
  const body = await req.json();

  const agentResponse = await fetch(`${AGENT_URL}/api/v1/analytics/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.INTERNAL_API_KEY && {
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
      }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!agentResponse.ok) {
    // Forward the upstream error body for debugging visibility
    const errorBody = await agentResponse.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: `Agent returned ${agentResponse.status}`,
        detail: errorBody,
      }),
      { status: agentResponse.status, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(agentResponse.body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  });
}
