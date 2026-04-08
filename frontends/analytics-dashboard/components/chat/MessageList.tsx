"use client";

import { useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Message } from "./Message";
import { FollowUpChips } from "./FollowUpChips";
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
  /** Follow-up suggestions keyed by assistant message ID */
  followUpsByMessage: Record<string, string[]>;
  /** Called when the user clicks a follow-up chip — populates input without submitting */
  onSuggestionSelect: (query: string) => void;
  isStreaming: boolean;
}

export function MessageList({
  messages,
  uiComponentsByMessage,
  followUpsByMessage,
  onSuggestionSelect,
  isStreaming,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Index of the last assistant message in the list
  const lastAssistantIdx = messages.reduceRight(
    (found, m, idx) => (found === -1 && m.role === "assistant" ? idx : found),
    -1
  );

  return (
    <ScrollArea className="flex-1">
      <div className="w-full max-w-[65rem] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        {messages.map((message, idx) => {
          const isLastAssistant = idx === lastAssistantIdx;
          const followUps =
            isLastAssistant && !isStreaming
              ? (followUpsByMessage[message.id] ?? [])
              : [];

          return (
            <div key={message.id}>
              <Message
                message={message}
                uiComponents={uiComponentsByMessage[message.id] || []}
                isStreaming={isLastAssistant && isStreaming}
              />
              {followUps.length > 0 && (
                <FollowUpChips
                  suggestions={followUps}
                  onSelect={onSuggestionSelect}
                />
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
