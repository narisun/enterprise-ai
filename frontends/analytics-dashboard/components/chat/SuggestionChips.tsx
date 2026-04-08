"use client";

import { TrendingUp, PieChart, DollarSign, BarChart3, Newspaper, Building2 } from "lucide-react";

/**
 * Data-grounded suggestions drawn from real entities in the testdata schemas:
 *   bankdw  — fact_payments, dim_party (Microsoft Corp., Ford Motor Company, Delta Air Lines, …)
 *   sfcrm   — Account (Acme Corp, TechNova Solutions, Meridian Healthcare, Apex Financial, …)
 *
 * Queries containing [placeholder] signal that the user should substitute a value
 * before sending. The no-auto-submit behavior (Feature 2) ensures they can do so.
 */
const SUGGESTIONS = [
  {
    label: "Payment trends for [company]",
    query: "Show payment trends for [company name] over the last 90 days",
    icon: TrendingUp,
  },
  {
    label: "Top payment volume by bank",
    query: "Which banks processed the highest inbound payment volume last quarter?",
    icon: BarChart3,
  },
  {
    label: "Pipeline stage breakdown",
    query: "Show the current Salesforce opportunity pipeline broken down by stage and total value",
    icon: PieChart,
  },
  {
    label: "Top accounts by revenue",
    query: "List the top 10 CRM accounts ranked by annual revenue",
    icon: Building2,
  },
  {
    label: "Risk view for [company]",
    query: "Show payment activity and open CRM cases for [company name]",
    icon: DollarSign,
  },
  {
    label: "Financial regulatory news",
    query: "Summarize recent regulatory and compliance news in the financial services sector",
    icon: Newspaper,
  },
];

interface SuggestionChipsProps {
  onSelect: (query: string) => void;
}

export function SuggestionChips({ onSelect }: SuggestionChipsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
      {SUGGESTIONS.map(({ label, query, icon: Icon }) => (
        <button
          key={query}
          onClick={() => onSelect(query)}
          className="flex items-center gap-3 px-4 py-3.5 text-[13px] rounded-xl border border-border/50 bg-surface hover:bg-surface-2 hover:border-border text-text-muted hover:text-text transition-all duration-150 text-left group"
        >
          <Icon size={16} className="shrink-0 text-accent/50 group-hover:text-accent/80 transition-colors" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}
