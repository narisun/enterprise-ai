"use client";

interface FollowUpChipsProps {
  suggestions: string[];
  onSelect: (query: string) => void;
}

/**
 * Contextual follow-up suggestion chips rendered below an assistant response.
 *
 * Visually distinct from the welcome-screen SuggestionChips (outlined style vs.
 * filled surface) to signal that these are grounded in the preceding response
 * rather than generic starting points.
 *
 * Clicking populates the input without submitting — same click-to-populate
 * behavior as the welcome screen chips (Feature 2).
 */
export function FollowUpChips({ suggestions, onSelect }: FollowUpChipsProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="mt-4 space-y-2.5">
      <p className="text-[11px] text-text-muted/50 tracking-wide uppercase font-medium">
        Want to go deeper?
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSelect(suggestion)}
            className="text-[12px] px-3 py-1.5 rounded-full border border-border/60
                       bg-transparent hover:bg-surface hover:border-border
                       text-text-muted hover:text-text transition-all duration-150
                       text-left max-w-[32rem] leading-snug"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
