"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { LogOut } from "lucide-react";
import { getUserDisplayName, getInitials } from "@/lib/utils";

/**
 * User profile and logout button for the sidebar footer.
 * Shows the authenticated user's name/email and a logout link.
 */
export function UserMenu() {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 animate-pulse">
        <div className="w-8 h-8 rounded-full bg-surface-2" />
        <div className="h-3 w-24 bg-surface-2 rounded" />
      </div>
    );
  }

  if (!user) return null;

  const displayName = getUserDisplayName(user.name, user.email);
  const initials = getInitials(displayName);

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex items-center gap-2.5 min-w-0">
        {user.picture ? (
          <img
            src={user.picture}
            alt={displayName}
            className="w-7 h-7 rounded-full shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-semibold text-accent shrink-0">
            {initials}
          </div>
        )}
        <span className="text-xs text-text truncate">{displayName}</span>
      </div>
      <a
        href="/auth/logout"
        className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
        title="Sign out"
      >
        <LogOut size={14} />
      </a>
    </div>
  );
}
