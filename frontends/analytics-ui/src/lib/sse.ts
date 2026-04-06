/**
 * SSE Stream — pure async generator for Server-Sent Events.
 *
 * Decouples SSE wire-format parsing from React state management.
 * Handles line endings (\r\n and \n), event buffering, and JSON parsing.
 *
 * Ported from the existing agent-ui sseStream.js pattern, converted to TypeScript.
 */

export interface ParsedSSEEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Consume a POST SSE endpoint as an async generator of parsed events.
 *
 * @param url - The SSE endpoint URL (e.g., "/api/v1/analytics/stream")
 * @param body - Request body to POST
 * @param headers - Additional headers
 */
export async function* sseStream(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): AsyncGenerator<ParsedSSEEvent> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`SSE request failed: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Response body is null — SSE not supported");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let currentData = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData += line.slice(6);
        } else if (line === "") {
          // Empty line = end of event
          if (currentData) {
            try {
              const parsed = JSON.parse(currentData);
              yield { event: currentEvent, data: parsed };
            } catch {
              // Non-JSON data — yield as raw string
              yield { event: currentEvent, data: { raw: currentData } };
            }
          }
          currentEvent = "message";
          currentData = "";
        }
      }
    }

    // Flush any remaining data
    if (currentData) {
      try {
        const parsed = JSON.parse(currentData);
        yield { event: currentEvent, data: parsed };
      } catch {
        yield { event: currentEvent, data: { raw: currentData } };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
