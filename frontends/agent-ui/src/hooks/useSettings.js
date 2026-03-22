/**
 * useSettings — Reactive settings state with auto-persistence.
 *
 * Encapsulates settings loading, updating, and saving so that
 * no component needs to know about localStorage or defaults.
 *
 * @module hooks/useSettings
 */

import { useState, useCallback } from 'react'
import { loadSettings, saveSettings } from '../lib/settings.js'

/**
 * @returns {{
 *   settings: import('../lib/settings').Settings,
 *   updateSetting: (key: string, value: any) => void,
 *   resetSettings: () => void,
 * }}
 */
export function useSettings() {
  const [settings, setSettings] = useState(() => loadSettings())

  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
  }, [])

  const resetSettings = useCallback(() => {
    const defaults = loadSettings()  // will return defaults when storage is cleared
    setSettings(defaults)
    saveSettings(defaults)
  }, [])

  return { settings, updateSetting, resetSettings }
}
