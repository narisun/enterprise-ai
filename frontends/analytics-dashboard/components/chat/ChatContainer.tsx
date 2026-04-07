"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useStreamData } from "@/hooks/useStreamData";
import { loadMessages, saveMessages } from "@/hooks/useConversations";
import { generateId } from "@/lib/utils";
import { traceChatRequest, traceStream } from "@/lib/telemetry";
import type { UIComponent } from "@/lib/types";

interface ChatContainerProps {
  chatId: string;
  onNewMessage?: (chatId: string, firstMessage: string) => void;
}

export function ChatContainer({ chatId, onNewMessage }: ChatContainerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const hasNotifiedRef = useRef(false);
  const traceRefsRef = useRef<{
    chatRequestTrace: ReturnType<typeof traceChatRequest> | null;
    streamTrace: ReturnType<typeof traceStream> | null;
  }>({ chatRequestTrace: null, streamTrace: null });

  // Restore messages AND their UI components from localStorage
  const { initialMessages, restoredComponents } = useMemo(() => {
    const saved = loadMessages(chatId);
    if (saved.length === 0) return { initialMessages: undefined, restoredComponents: {} };

    const msgs = saved.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Rebuild the uiComponentMap from persisted component data
    const compMap: Record<string, UIComponent[]> = {};
    for (const m of saved) {
      if (m.components && m.components.length > 0) {
        compMap[m.id] = m.components;
      }
    }

    return { initialMessages: msgs, restoredComponents: compMap };
  }, [chatId]);

  const [uiComponentMap, setUiComponentMap] = useState<Record<string, UIComponent[]>>(restoredComponents);

  // Reset the component map when switching conversations
  useEffect(() => {
    setUiComponentMap(restoredComponents);
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    data,
    setInput,
    stop,
  } = useChat({
    api: "/api/chat",
    id: chatId,
    streamProtocol: "data",
    generateId: generateId,
    initialMessages,
  });

  const isStreaming = status === "streaming";
  const prevStatusRef = useRef(status);

  const { turnComponents, totalCount, commitTurn } = useStreamData(
    data as unknown[] | undefined
  );

  const commitTurnRef = useRef(commitTurn);
  commitTurnRef.current = commitTurn;

  // Track streaming start: initiate stream trace and bind to components
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev !== "streaming" && status === "streaming") {
      // Streaming just started — initialize traces
      traceRefsRef.current.chatRequestTrace = traceChatRequest(chatId);
      traceRefsRef.current.streamTrace = traceStream(chatId);
    }
  }, [status, chatId]);

  // Bind streaming UI components to the latest assistant message.
  // Also track first token and component arrivals in traces.
  // Uses totalCount (primitive) as a stable dependency proxy.
  useEffect(() => {
    if (turnComponents.length === 0) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;

    setUiComponentMap((prev) => {
      if (prev[lastAssistant.id]?.length === turnComponents.length) return prev;

      // Track first token arrival if not yet recorded
      const streamTrace = traceRefsRef.current.streamTrace;
      if (streamTrace && totalCount === 1) {
        streamTrace.onFirstToken();
      }

      // Track component arrivals
      const newComponents = turnComponents.slice(prev[lastAssistant.id]?.length || 0);
      for (const comp of newComponents) {
        streamTrace?.onComponent(comp.component_type);
      }

      return { ...prev, [lastAssistant.id]: turnComponents };
    });
  }, [totalCount, messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Commit turn offset and persist messages when streaming finishes
  // Also end the traces when streaming completes
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if (prev === "streaming" && status !== "streaming") {
      // End traces
      const streamTrace = traceRefsRef.current.streamTrace;
      if (streamTrace) {
        streamTrace.end(turnComponents.length);
      }
      const chatRequestTrace = traceRefsRef.current.chatRequestTrace;
      if (chatRequestTrace) {
        chatRequestTrace.end("ok");
      }

      commitTurnRef.current();
      if (messages.length > 0) {
        saveMessages(
          chatId,
          messages as { role: string; content: string; id: string }[],
          uiComponentMap
        );
      }
    }
  }, [status, chatId, messages, turnComponents.length]);

  // Notify parent exactly once when the first user message is sent
  useEffect(() => {
    if (hasNotifiedRef.current) return;
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (firstUserMsg && onNewMessage) {
      hasNotifiedRef.current = true;
      onNewMessage(chatId, firstUserMsg.content);
    }
  }, [messages, chatId, onNewMessage]);

  const handleSuggestionSelect = useCallback(
    (query: string) => {
      setInput(query);
      // Submit after React flushes the input state update
      setTimeout(() => formRef.current?.requestSubmit(), 50);
    },
    [setInput]
  );

  const hasMessages = messages.length > 0;

  if (!hasMessages) {
    return (
      <EmptyState
        input={input}
        onInputChange={handleInputChange}
        onSubmit={handleSubmit}
        isLoading={isStreaming}
        onSuggestionSelect={handleSuggestionSelect}
        formRef={formRef}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col h-full">
      <MessageList
        messages={messages}
        uiComponentsByMessage={uiComponentMap}
        isStreaming={isStreaming}
      />

      <div className="px-6 pb-5 pt-2">
        <div className="w-full max-w-[65rem] mx-auto">
          <ChatInput
            input={input}
            onInputChange={handleInputChange}
            onSubmit={handleSubmit}
            isLoading={isStreaming}
            onStop={stop}
            variant="floating"
            formRef={formRef}
          />
          <p className="text-[11px] text-text-muted/35 text-center mt-2.5 tracking-wide">
            Analytics AI can make mistakes. Verify important data.
          </p>
        </div>
      </div>
    </div>
  );
}
