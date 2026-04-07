"use client";

import { useState, useRef, useEffect } from "react";
import { LogOut, Moon, Sun, Monitor } from "lucide-react";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useTheme, type Theme } from "@/components/theme/ThemeProvider";
import { getUserDisplayName, getInitials } from "@/lib/utils";

const themeIcons: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const themeLabels: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme } = useTheme();
  const { user, isLoading } = useUser();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const cycleTheme = () => {
    const order: Theme[] = ["dark", "light", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const ThemeIcon = themeIcons[theme];

  const displayName = getUserDisplayName(user?.name, user?.email);
  const initials = getInitials(displayName);

  if (isLoading) {
    return (
      <div className="w-8 h-8 rounded-full bg-surface-2 animate-pulse" />
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-8 h-8 rounded-full bg-accent text-white text-xs font-semibold hover:ring-2 hover:ring-accent/40 transition-all"
      >
        {user?.picture ? (
          <img
            src={user.picture}
            alt={displayName}
            className="w-8 h-8 rounded-full"
          />
        ) : (
          initials
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-surface shadow-xl py-2 z-50 animate-fade-in">
          <div className="px-4 py-2.5 border-b border-border">
            <p className="text-sm font-medium text-text">{displayName}</p>
            {user?.email && user.email !== displayName && (
              <p className="text-xs text-text-muted">{user.email}</p>
            )}
          </div>

          <button
            onClick={cycleTheme}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
          >
            <ThemeIcon size={16} />
            <span>Theme: {themeLabels[theme]}</span>
          </button>

          <a
            href="/auth/logout"
            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </a>
        </div>
      )}
    </div>
  );
}
