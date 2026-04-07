"use client";

import { useState } from "react";
import { PenSquare, Search, Settings, HelpCircle, Menu } from "lucide-react";
import { ConversationItem } from "./ConversationItem";
import { UserMenu } from "./UserMenu";
import { getTimeGroup } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

interface SidebarProps {
  conversations: Conversation[];
  activeChatId: string;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onRenameChat?: (id: string, newTitle: string) => void;
  onToggleSidebar: () => void;
}

export function Sidebar({
  conversations,
  activeChatId,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onToggleSidebar,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);

  // Filter conversations by search
  const filtered = searchQuery.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  // Group conversations by time
  const groups = new Map<string, Conversation[]>();
  for (const conv of filtered) {
    const group = getTimeGroup(conv.updatedAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(conv);
  }

  return (
    <div className="flex h-full w-64 flex-col bg-surface">
      <div className="flex items-center justify-between px-3 pt-3.5 pb-1.5">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Enterprise AI" className="w-6 h-6" />
          <span className="text-[15px] font-semibold text-text tracking-tight">Enterprise AI</span>
        </div>
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
          aria-label="Close sidebar"
        >
          <Menu size={18} />
        </button>
      </div>

      <div className="flex items-center justify-between px-3 pt-1 pb-1">
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-text hover:bg-surface-2 transition-colors w-full"
        >
          <PenSquare size={16} className="text-text-muted" />
          <span>New chat</span>
        </button>
        <button
          onClick={() => setSearchVisible(!searchVisible)}
          className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
          aria-label="Search conversations"
        >
          <Search size={16} />
        </button>
      </div>

      {searchVisible && (
        <div className="px-3 pb-2 animate-fade-in">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            autoFocus
            className="w-full rounded-lg border border-border bg-surface-2 py-2 px-3 text-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent/40"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2">
        <div className="space-y-4 py-2 pb-4">
          {Array.from(groups.entries()).map(([group, convs]) => (
            <div key={group}>
              <p className="px-3 py-1.5 text-[11px] font-medium text-text-muted/60">
                {group}
              </p>
              <div className="space-y-0.5">
                {convs.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isActive={conv.id === activeChatId}
                    onSelect={onSelectChat}
                    onDelete={onDeleteChat}
                    onRename={onRenameChat}
                  />
                ))}
              </div>
            </div>
          ))}

          {filtered.length === 0 && conversations.length > 0 && (
            <p className="text-center text-xs text-text-muted/60 py-8">
              No matching conversations
            </p>
          )}

          {conversations.length === 0 && (
            <p className="text-center text-xs text-text-muted/50 py-8">
              No conversations yet
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-border px-2 py-2 space-y-0.5">
        <UserMenu />
      </div>
    </div>
  );
}
