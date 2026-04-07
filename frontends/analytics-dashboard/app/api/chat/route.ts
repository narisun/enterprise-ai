/**
 * Streaming proxy to the analytics-agent backend.
 *
 * Next.js rewrites() buffer full responses, breaking SSE/streaming.
 * This route handler pipes the agent response as a ReadableStream,
 * preserving real-time token delivery for the Data Stream Protocol.
 *
 * Auth flow:
 *   1. Auth0 middleware has already validated the user session (cookie)
 *   2. This route extracts user identity from the session
 *   3. Forwards X-User-Email and X-User-Role headers to the agent
 *   4. Agent propagates user_role to MCP tools → OPA for authorization
 */
import { auth0 } from "@/lib/auth0";

const AGENT_URL = process.env.ANALYTICS_AGENT_URL || "http://analytics-agent:8000";
const REQUEST_TIMEOUT_MS = 120_000;

export async function POST(req: Request) {
  // Extract authenticated user from Auth0 session
  const session = await auth0.getSession();
  const userEmail = session?.user?.email || "anonymous";
  // Auth0 custom claim namespace — set via Auth0 Action (see docs/DEPLOYMENT.md)
  const userRole =
    session?.user?.["https://enterprise-ai/role"] ||
    session?.user?.role ||
    "analyst";

  const body = await req.json();

  const agentResponse = await fetch(`${AGENT_URL}/api/v1/analytics/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.INTERNAL_API_KEY && {
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
      }),
      // Forward authenticated user identity to the agent
      "X-User-Email": userEmail,
      "X-User-Role": userRole,
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
