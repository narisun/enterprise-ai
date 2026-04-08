"use client";

import { AlertTriangle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useUser } from "@auth0/nextjs-auth0/client";
import { getUserDisplayName, getInitials } from "@/lib/utils";
import { ThinkingBlock } from "./ThinkingBlock";
import { SqlReveal } from "./SqlReveal";
import { ChartRenderer } from "@/components/charts/ChartRenderer";
import type { UIComponent } from "@/lib/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AIMessage {
  id: string;
  role: "user" | "assistant" | "system" | "data";
  content: string;
  parts?: Array<{ type: string; [key: string]: unknown }>;
}

interface MessageProps {
  message: AIMessage;
  uiComponents?: UIComponent[];
  isStreaming?: boolean;
}

function isErrorMessage(text: string): boolean {
  const errorPatterns = [
    /^I encountered an issue/i,
    /^I('m| am) unable to/i,
    /^Sorry,? I (couldn't|could not|can't|cannot)/i,
    /^Unfortunately,? (I |the |this )/i,
    /^Error:/i,
    /data is not available/i,
    /no data found/i,
    /couldn't retrieve/i,
    /failed to (fetch|retrieve|query|load)/i,
  ];
  return errorPatterns.some((p) => p.test(text.trim()));
}

export function Message({ message, uiComponents = [], isStreaming = false }: MessageProps) {
  const { user } = useUser();
  const isUser = message.role === "user";
  const initials = getInitials(getUserDisplayName(user?.name, user?.email));

  // Extract reasoning from message parts (Vercel AI SDK v4)
  const rawReasoningText = (message.parts || [])
    .filter((part) => part.type === "reasoning")
    .map((part) => String(part.reasoning || ""))
    .join("");

  // Extract SQL queries from reasoning markers and strip them from display text
  const sqlQueries: string[] = [];
  const reasoningText = rawReasoningText.replace(
    /__SQL_QUERY__:([\s\S]*?):__END_SQL__/g,
    (_match, sql) => {
      sqlQueries.push(sql.trim());
      return "";
    }
  );

  // Extract text content from parts or fallback to content
  const textContent = message.content || (message.parts || [])
    .filter((part) => part.type === "text")
    .map((part) => String(part.text || ""))
    .join("");

  const hasError = !isUser && textContent && isErrorMessage(textContent);

  // Separate KPI cards from chart components for layout
  const kpiComponents = uiComponents.filter((c) => c.component_type === "KPICard");
  const chartComponents = uiComponents.filter((c) => c.component_type !== "KPICard");

  return (
    <div className="animate-fade-in">
      {isUser && (
        <div className="flex justify-end gap-3">
          <div className="rounded-2xl rounded-tr-md bg-accent/10 px-4 py-2.5 text-sm text-text max-w-[92%] sm:max-w-[80%]">
            {textContent}
          </div>
          <Avatar className="mt-0.5 shrink-0 w-7 h-7">
            <AvatarFallback className="bg-accent text-white text-[10px] font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      {!isUser && (
        <div className="space-y-3">
          {reasoningText && (
            <ThinkingBlock
              reasoning={reasoningText}
              isStreaming={isStreaming}
              hasNarrativeStarted={textContent.length > 0}
            />
          )}

          {sqlQueries.length > 0 && (
            <SqlReveal queries={sqlQueries} />
          )}

          {hasError && (
            <div className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3">
              <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
              <div className="text-sm text-danger/90 leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {textContent}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {textContent && !hasError && (
            <div className="prose prose-invert prose-sm max-w-none text-text/90 leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-4 rounded-xl border border-border">
                      <table className="w-full text-sm border-collapse">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-surface-2">{children}</thead>
                  ),
                  th: ({ children }) => (
                    <th className="text-left px-4 py-2.5 text-text-muted font-medium border-b border-border text-xs">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-4 py-2 border-b border-border/50 text-text-muted text-xs">
                      {children}
                    </td>
                  ),
                  code: ({ children, className }) => {
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code className="bg-surface-2 px-1.5 py-0.5 rounded text-accent-2 text-xs font-mono">
                          {children}
                        </code>
                      );
                    }
                    return (
                      <pre className="bg-surface-2 border border-border rounded-xl p-4 overflow-x-auto text-xs my-3">
                        <code className="font-mono">{children}</code>
                      </pre>
                    );
                  },
                  strong: ({ children }) => (
                    <strong className="font-semibold text-text">{children}</strong>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      className="text-accent hover:text-accent/80 underline underline-offset-2"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {textContent}
              </ReactMarkdown>
            </div>
          )}

          {kpiComponents.length === 1 && (
            <div className="w-full">
              <ChartRenderer key="kpi-0" component={kpiComponents[0]} />
            </div>
          )}

          {kpiComponents.length > 1 && (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 w-full">
              {kpiComponents.map((component, idx) => (
                <ChartRenderer key={`kpi-${idx}`} component={component} />
              ))}
            </div>
          )}

          {chartComponents.length > 0 && (
            <div className="space-y-4 w-full">
              {chartComponents.map((component, idx) => (
                <ChartRenderer key={`chart-${idx}`} component={component} />
              ))}
            </div>
          )}

          {isStreaming && !textContent && !reasoningText && (
            <div className="flex items-center gap-2 text-sm text-text-muted py-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
