"use client";

import { TrendingUp, PieChart, DollarSign, BarChart3, Newspaper, Building2 } from "lucide-react";

const SUGGESTIONS = [
  { label: "Revenue by account", query: "Show me revenue by account", icon: DollarSign },
  { label: "Salesforce pipeline", query: "What's in the Salesforce pipeline?", icon: PieChart },
  { label: "Payment trends", query: "Payment trends for Microsoft", icon: TrendingUp },
  { label: "Top accounts", query: "Top accounts by annual revenue", icon: Building2 },
  { label: "Opportunity stages", query: "Show opportunity stages breakdown", icon: BarChart3 },
  { label: "Recent news", query: "Recent news about Tesla", icon: Newspaper },
];

interface SuggestionChipsProps {
  onSelect: (query: string) => void;
}

export function SuggestionChips({ onSelect }: SuggestionChipsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {SUGGESTIONS.map(({ label, query, icon: Icon }) => (
        <button
          key={query}
          onClick={() => onSelect(query)}
          className="flex items-center gap-2.5 px-4 py-3 text-sm rounded-xl border border-border bg-surface hover:bg-surface-2 text-text-muted hover:text-text transition-colors text-left"
        >
          <Icon size={16} className="shrink-0 text-text-muted/60" />
          <span className="truncate text-xs">{label}</span>
        </button>
      ))}
    </div>
  );
}
