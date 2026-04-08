"use client";

import type { RefObject } from "react";
import { BarChart3 } from "lucide-react";
import { useUser } from "@auth0/nextjs-auth0/client";
import { getUserDisplayName } from "@/lib/utils";
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
  const { user } = useUser();
  const displayFirstName = getUserDisplayName(user?.name, user?.email).split(" ")[0];

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 md:px-6 md:-mt-8">
      <div className="w-full max-w-[49rem] space-y-6 md:space-y-10">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 mb-2">
            <BarChart3 size={22} className="text-accent/70" />
          </div>
          <h1 className="text-2xl md:text-[28px] font-medium leading-tight">
            <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
              Hi {displayFirstName}
            </span>
          </h1>
          <p className="text-lg md:text-[22px] text-text-muted/70 font-light tracking-[-0.01em]">
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
        <p className="text-[11px] text-text-muted/40 text-center tracking-wide">
          Click a suggestion to populate the input — edit before sending
        </p>
      </div>
    </div>
  );
}
