"use client";

import { MoreVertical, Trash2, Pencil } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { cn, truncate } from "@/lib/utils";
import type { Conversation } from "@/lib/types";
import { createPortal } from "react-dom";

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, newTitle: string) => void;
}

export function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: ConversationItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleOpenMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.left - 80) });
    }
    setMenuOpen((prev) => !prev);
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(conversation.id);
    setMenuOpen(false);
  }, [conversation.id, onDelete]);

  const handleStartRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(conversation.title);
    setIsRenaming(true);
    setMenuOpen(false);
  }, [conversation.title]);

  const handleCommitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.title && onRename) {
      onRename(conversation.id, trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, conversation.id, conversation.title, onRename]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCommitRename();
    else if (e.key === "Escape") setIsRenaming(false);
  }, [handleCommitRename]);

  const showDots = hovered || menuOpen;

  if (isRenaming) {
    return (
      <div className="w-full">
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleCommitRename}
          onKeyDown={handleRenameKeyDown}
          className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text bg-surface-2 border border-accent/40 focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className="w-full relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={() => onSelect(conversation.id)}
        role="button"
        className={cn(
          "w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors cursor-pointer",
          "flex items-center",
          isActive
            ? "bg-surface-2 text-text"
            : "text-text-muted hover:bg-surface-2/60 hover:text-text"
        )}
      >
        <span className="flex-1 min-w-0 truncate text-[13px]">
          {truncate(conversation.title, 32)}
        </span>

        <div
          ref={triggerRef}
          onClick={handleOpenMenu}
          style={{ opacity: showDots ? 1 : 0, minWidth: 24, minHeight: 24 }}
          className="flex items-center justify-center rounded hover:bg-surface-2 text-text-muted hover:text-text transition-opacity flex-shrink-0 ml-1"
        >
          <MoreVertical size={15} />
        </div>
      </div>

      {/* Dropdown menu — portal to body to avoid scroll clipping */}
      {menuOpen && mounted &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
            className="w-36 rounded-lg border border-border bg-surface shadow-xl py-1 animate-fade-in"
          >
            {onRename && (
              <button
                onClick={handleStartRename}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
              >
                <Pencil size={13} />
                <span>Rename</span>
              </button>
            )}
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-danger hover:bg-surface-2 transition-colors"
            >
              <Trash2 size={13} />
              <span>Delete</span>
            </button>
          </div>,
          document.body
        )
      }
    </div>
  );
}
