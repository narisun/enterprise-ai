"use client";

import { Menu, PenSquare } from "lucide-react";
import { UserMenu } from "./UserMenu";

interface TopBarProps {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void;
}

export function TopBar({ title, sidebarOpen, onToggleSidebar, onNewChat }: TopBarProps) {
  return (
    <div className="flex items-center h-14 px-4 bg-background shrink-0 z-20">
      <div className="flex items-center gap-1">
        {!sidebarOpen && (
          <>
            <button
              onClick={onToggleSidebar}
              className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
              aria-label="Open sidebar"
            >
              <Menu size={18} />
            </button>
            <button
              onClick={onNewChat}
              className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
              aria-label="New chat"
            >
              <PenSquare size={16} />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 flex justify-center min-w-0 px-4">
        {title && (
          <h1 className="text-[15px] font-medium text-text/90 truncate max-w-lg">
            {title}
          </h1>
        )}
      </div>

      <div className="flex items-center">
        <UserMenu />
      </div>
    </div>
  );
}
