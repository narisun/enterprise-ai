"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronUp, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  reasoning: string;
  isStreaming: boolean;
  /** When true, narrative text has started arriving — trigger auto-collapse */
  hasNarrativeStarted: boolean;
}

export function ThinkingBlock({ reasoning, isStreaming, hasNarrativeStarted }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(true);
  const hasAutoCollapsed = useRef(false);

  // Auto-collapse when narrative text starts arriving
  useEffect(() => {
    if (hasNarrativeStarted && !hasAutoCollapsed.current && reasoning.length > 0) {
      const timer = setTimeout(() => {
        setIsOpen(false);
        hasAutoCollapsed.current = true;
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [hasNarrativeStarted, reasoning]);

  const isReasoningActive = isStreaming && !hasNarrativeStarted;

  if (!reasoning) return null;

  // Parse reasoning into titled sections or plain lines
  const lines = reasoning.split("\n").filter(Boolean);

  // Group lines into sections by detecting title patterns
  const sections: { title?: string; lines: string[] }[] = [];
  let currentSection: { title?: string; lines: string[] } = { lines: [] };

  for (const line of lines) {
    if (line.match(/^(Analyzing|Classifying|Planning|Querying|Processing|Fetching|Routing|Evaluating|Generating)/i)) {
      if (currentSection.lines.length > 0 || currentSection.title) {
        sections.push(currentSection);
      }
      currentSection = { title: line, lines: [] };
    } else {
      currentSection.lines.push(line);
    }
  }
  if (currentSection.lines.length > 0 || currentSection.title) {
    sections.push(currentSection);
  }

  return (
    <div className="space-y-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 py-1.5 text-sm text-text-muted hover:text-text transition-colors"
      >
        {isReasoningActive ? (
          <Loader2 size={16} className="animate-spin text-accent" />
        ) : (
          <Sparkles size={16} className="text-accent" />
        )}
        <span className="font-medium">
          {isReasoningActive ? "Thinking..." : "Show thinking"}
        </span>
        <ChevronUp
          size={14}
          className={cn(
            "transition-transform duration-200",
            !isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Fully expanded content — no scroll constraint to show all reasoning */}
      {isOpen && (
        <div className="border-l-2 border-accent/30 pl-4 ml-2 animate-fade-in">
          <div className="space-y-3 py-1 pr-2">
            {sections.map((section, i) => (
              <div key={i} className="space-y-1">
                {section.title && (
                  <p className="text-sm font-semibold italic text-text/80">
                    {section.title}
                  </p>
                )}
                {section.lines.map((line, j) => (
                  <p key={j} className="text-sm italic text-text-muted leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            ))}
            {isReasoningActive && (
              <p className="text-sm italic text-accent/60 animate-pulse-subtle">
                {"\u2026"}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
