"use client";

import type { RefObject } from "react";
import { BarChart3 } from "lucide-react";
import { ChatInput } from "./ChatInput";
import { SuggestionChips } from "./SuggestionChips";

interface EmptyStateProps {
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  onSuggestionSelect: (query: string) => void;
  formRef?: RefObject<HTMLFormElement | null>;
}

export function EmptyState({
  input,
  onInputChange,
  onSubmit,
  isLoading,
  onSuggestionSelect,
  formRef,
}: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl space-y-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 size={24} className="text-accent" />
          </div>
          {/* TODO: Pull user name from auth context for multi-user deployments */}
          <h1 className="text-3xl font-medium">
            <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
              Hi Sundar
            </span>
          </h1>
          <p className="text-2xl text-text-muted font-light">
            What would you like to analyze?
          </p>
        </div>

        <ChatInput
          input={input}
          onInputChange={onInputChange}
          onSubmit={onSubmit}
          isLoading={isLoading}
          autoFocus
          placeholder="Ask about revenue, pipeline, payments, accounts..."
          variant="hero"
          formRef={formRef}
        />

        <SuggestionChips onSelect={onSuggestionSelect} />
      </div>
    </div>
  );
}
