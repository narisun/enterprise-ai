/**
 * useChat — Multi-turn conversation layer on top of useAnalyticsStream.
 *
 * Manages conversation history, session state, and the relationship
 * between the chat panel and the streaming analytics engine.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAnalyticsStream } from "./useAnalyticsStream";
import type { ChatMessage, UIComponent, TraceEvent } from "../lib/types";

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem("analytics-session-id");
    if (existing) return existing;
    const id = uuidv4();
    sessionStorage.setItem("analytics-session-id", id);
    return id;
  } catch {
    return uuidv4();
  }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId] = useState(getOrCreateSessionId);
  const stream = useAnalyticsStream();
  const pendingRef = useRef(false);

  // When streaming completes, save the assistant message with components
  useEffect(() => {
    if (stream.status === "complete" && pendingRef.current) {
      pendingRef.current = false;
      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: stream.narrative,
        components: stream.components.length > 0 ? [...stream.components] : undefined,
        traceEvents: stream.traceEvents.length > 0 ? [...stream.traceEvents] : undefined,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    }
  }, [stream.status, stream.narrative, stream.components, stream.traceEvents]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || pendingRef.current) return;

      // Add user message
      const userMsg: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content: text.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      pendingRef.current = true;

      // Start streaming
      await stream.send(sessionId, text.trim());
    },
    [sessionId, stream.send]
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    try {
      sessionStorage.removeItem("analytics-session-id");
    } catch {
      // Ignore storage errors
    }
  }, []);

  return {
    messages,
    sendMessage,
    clearHistory,
    sessionId,
    // Current stream state (for live rendering)
    streamStatus: stream.status,
    streamNarrative: stream.narrative,
    streamComponents: stream.components,
    streamTraceEvents: stream.traceEvents,
    streamError: stream.error,
  };
}
