"use client";

import { useState, useEffect, useCallback } from "react";
import type { Conversation, UIComponent } from "@/lib/types";

const STORAGE_KEY = "analytics-conversations";
const MSG_PREFIX = "analytics-msgs-";

function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // Storage full or unavailable — silent fail
  }
}

/** Load persisted messages for a specific conversation (includes UI components). */
export function loadMessages(
  chatId: string
): { role: string; content: string; id: string; components?: UIComponent[] }[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MSG_PREFIX + chatId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save messages for a specific conversation (preserves UI components for assistant messages). */
export function saveMessages(
  chatId: string,
  messages: { role: string; content: string; id: string }[],
  componentsByMessage?: Record<string, UIComponent[]>
) {
  try {
    // Only persist user & assistant messages (not system).
    // Attach UI components to each assistant message so charts render from history.
    const slim = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const base: { id: string; role: string; content: string; components?: UIComponent[] } = {
          id: m.id,
          role: m.role,
          content: m.content,
        };
        const components = componentsByMessage?.[m.id];
        if (components && components.length > 0) {
          base.components = components;
        }
        return base;
      });
    localStorage.setItem(MSG_PREFIX + chatId, JSON.stringify(slim));
  } catch {
    // Storage full — silent fail
  }
}

/** Remove persisted messages for a conversation */
function removeMessages(chatId: string) {
  try {
    localStorage.removeItem(MSG_PREFIX + chatId);
  } catch {}
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    // useConversations is only called client-side (marked "use client"), so no SSR guard needed here
    setConversations(loadConversations());
  }, []);

  const save = useCallback(
    (id: string, title: string, messageCount: number) => {
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === id);
        const now = Date.now();
        let updated: Conversation[];

        if (existing) {
          updated = prev.map((c) =>
            c.id === id
              ? { ...c, title: title || c.title, updatedAt: now }
              : c
          );
        } else {
          updated = [
            {
              id,
              title: title || "New conversation",
              createdAt: now,
              updatedAt: now,
              messages: [],
            },
            ...prev,
          ];
        }

        // Sort by most recently updated
        updated.sort((a, b) => b.updatedAt - a.updatedAt);

        // Keep max 50 conversations
        updated = updated.slice(0, 50);

        saveConversations(updated);
        return updated;
      });
    },
    []
  );

  const remove = useCallback((id: string) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      saveConversations(updated);
      removeMessages(id);
      return updated;
    });
  }, []);

  const rename = useCallback((id: string, newTitle: string) => {
    setConversations((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, title: newTitle, updatedAt: Date.now() } : c
      );
      saveConversations(updated);
      return updated;
    });
  }, []);

  return { conversations, save, remove, rename };
}
