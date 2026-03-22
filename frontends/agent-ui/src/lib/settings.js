/**
 * settings.js — Settings persistence layer.
 *
 * Extracted from SettingsPanel.jsx to separate persistence concerns
 * from UI rendering. No component should know HOW settings are stored.
 *
 * @module lib/settings
 */

const STORAGE_KEY = 'quantitix-settings'

/** @type {import('../types/settings').Settings} */
export const DEFAULT_SETTINGS = {
  // Profile
  region:             'EMEA',
  // Display
  cardMinWidth:       280,
  showComingSoon:     true,
  compactSidebar:     false,
  // Session
  autoResetOnSwitch:  false,
  // Data
  newsLookbackDays:   30,
  maxNewsResults:     10,
  // Appearance
  density:            'comfortable',
}

/**
 * Load settings from localStorage, merging with defaults.
 * Degrades gracefully in private browsing / quota-exceeded scenarios.
 *
 * @returns {import('../types/settings').Settings}
 */
export function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Persist settings to localStorage.
 * Silently degrades if storage is unavailable.
 *
 * @param {import('../types/settings').Settings} settings
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch { /* quota exceeded or private browsing — degrade silently */ }
}
