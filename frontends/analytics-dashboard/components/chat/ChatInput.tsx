"use client";

import { useRef, useEffect, type RefObject } from "react";
import { Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  onStop?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** "hero" = large centered, "floating" = bottom bar, "compact" = minimal */
  variant?: "hero" | "floating" | "compact";
  /** External ref for programmatic form submission (e.g. suggestion chips) */
  formRef?: RefObject<HTMLFormElement | null>;
}

export function ChatInput({
  input,
  onInputChange,
  onSubmit,
  isLoading,
  onStop,
  placeholder = "Ask about revenue, pipeline, payments...",
  autoFocus = false,
  variant = "compact",
  formRef,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isHero = variant === "hero";
  const isFloating = variant === "floating";
  const isLarge = isHero || isFloating;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxH = isLarge ? 200 : 180;
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxH)}px`;
    }
  }, [input, isLarge]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        onSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="relative">
      <div
        className={cn(
          "relative flex items-end rounded-2xl border bg-surface transition-all",
          "focus-within:border-accent/30",
          isHero && "border-border/80 shadow-lg focus-within:shadow-xl",
          isFloating && "border-border shadow-[0_-2px_20px_rgba(0,0,0,0.15)] focus-within:shadow-[0_-2px_28px_rgba(0,0,0,0.2)]",
          !isHero && !isFloating && "border-border shadow-sm focus-within:shadow-md"
        )}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={onInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={isLarge ? 2 : 1}
          className={cn(
            "flex-1 resize-none bg-transparent text-text placeholder:text-text-muted/50 focus:outline-none",
            isLarge
              ? "px-5 py-4 text-[15px] min-h-[72px] max-h-[200px]"
              : "px-4 py-3 text-sm min-h-[48px] max-h-[180px]"
          )}
        />
        <div className={cn("flex items-center gap-1", isLarge ? "pr-3 pb-3" : "pr-2 pb-2")}>
          {isLoading ? (
            <button
              type="button"
              onClick={onStop}
              className="p-2 rounded-full text-danger hover:bg-danger/10 transition-colors"
            >
              <Square size={isLarge ? 18 : 16} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={cn(
                "p-2 rounded-full transition-all",
                input.trim()
                  ? "bg-accent text-white hover:bg-accent/90 shadow-sm"
                  : "text-text-muted/30"
              )}
            >
              <Send size={isLarge ? 18 : 16} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
