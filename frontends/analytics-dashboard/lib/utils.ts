import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx + tailwind-merge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a timestamp into a relative time group label.
 */
export function getTimeGroup(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Last 7 Days";
  if (days <= 30) return "Last 30 Days";
  return "Older";
}

/**
 * Generate a UUID for session IDs.
 *
 * crypto.randomUUID() requires a secure context (HTTPS or localhost).
 * Falls back to a manual v4 UUID when running over plain HTTP.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback v4 UUID for insecure contexts (plain HTTP)
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      +c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
    ).toString(16)
  );
}

/**
 * Extract a clean display name from Auth0 user data.
 *
 * Auth0 sometimes sets user.name to the raw email address.
 * This function detects that case and builds a human-readable
 * name from the email prefix (e.g. "sundar.narisetti@…" → "Sundar Narisetti").
 */
export function getUserDisplayName(
  name?: string | null,
  email?: string | null
): string {
  const raw = name || email || "User";
  const looksLikeEmail = raw.includes("@");

  if (!looksLikeEmail && raw !== "User") return raw;

  // Parse "sundar.narisetti@gmail.com" → "Sundar Narisetti"
  const prefix = (email || raw).split("@")[0] || "user";
  return prefix
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Build 2-letter initials from the first name (e.g. "Sundar" → "SU").
 *
 * Uses the first two characters of the first name rather than first+last
 * initials, because not all users provide a last name. This keeps the
 * avatar consistent regardless of the name format.
 */
export function getInitials(displayName: string): string {
  const firstName = displayName.trim().split(/\s+/)[0] || "U";
  return firstName.slice(0, 2).toUpperCase();
}

/**
 * Truncate a string to maxLength with ellipsis.
 */
export function truncate(str: string, maxLength: number = 50): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength).trimEnd() + "…";
}
