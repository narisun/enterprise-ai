"use client";

import { useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Message } from "./Message";
import type { UIComponent } from "@/lib/types";

/** Minimal message shape from the Vercel AI SDK useChat hook */
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "data";
  content: string;
  parts?: Array<{ type: string; [key: string]: unknown }>;
}

interface MessageListProps {
  messages: ChatMessage[];
  uiComponentsByMessage: Record<string, UIComponent[]>;
  isStreaming: boolean;
}

export function MessageList({
  messages,
  uiComponentsByMessage,
  isStreaming,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  return (
    <ScrollArea className="flex-1">
      <div className="w-full max-w-[65rem] mx-auto px-6 py-6 space-y-6">
        {messages.map((message, idx) => {
          const isLastAssistant =
            idx === messages.length - 1 && message.role === "assistant";
          return (
            <Message
              key={message.id}
              message={message}
              uiComponents={uiComponentsByMessage[message.id] || []}
              isStreaming={isLastAssistant && isStreaming}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
