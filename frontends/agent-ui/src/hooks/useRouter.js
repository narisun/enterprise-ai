/**
 * useRouter — Lightweight client-side routing via the History API.
 *
 * Syncs app state (current view, selected agent) with the browser URL so
 * that:
 *   • The address bar always reflects the current view
 *   • The browser back/forward buttons navigate between views
 *   • Deep-linking to /help, /settings, /agent/rm-prep etc. works on load
 *
 * ── URL scheme ───────────────────────────────────────────────────────────
 *   /                    — Chat view (no agent selected)
 *   /agent/:agentId      — Chat view with a specific agent
 *   /help                — Help guide overlay
 *   /settings            — Settings overlay
 *   /profile             — User profile overlay
 *   /data-source/:id     — Data source detail overlay
 *
 * No external router library required — uses window.history directly.
 *
 * @module hooks/useRouter
 */

import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Parse the current URL pathname into a route descriptor.
 * @returns {{ view: string, param: string|null }}
 */
function parseLocation() {
  const path = window.location.pathname
  const segments = path.split('/').filter(Boolean)

  if (segments.length === 0) {
    return { view: 'chat', param: null }
  }

  const first = segments[0]

  switch (first) {
    case 'help':
      return { view: 'help', param: null }
    case 'settings':
      return { view: 'settings', param: null }
    case 'profile':
      return { view: 'profile', param: null }
    case 'data-source':
      return { view: 'data-source', param: segments[1] ?? null }
    case 'agent':
      return { view: 'chat', param: segments[1] ?? null }
    default:
      return { view: 'chat', param: null }
  }
}

/**
 * Build a URL path from a view name and optional param.
 */
function buildPath(view, param) {
  switch (view) {
    case 'help':        return '/help'
    case 'settings':    return '/settings'
    case 'profile':     return '/profile'
    case 'data-source': return param ? `/data-source/${param}` : '/'
    case 'chat':        return param ? `/agent/${param}` : '/'
    default:            return '/'
  }
}

/**
 * @param {object} options
 * @param {function} options.getAgentById — (id) => agent|null resolver
 */
export function useRouter({ getAgentById }) {
  // Parse initial URL on first render
  const initial = parseLocation()
  const [route, setRoute] = useState(initial)

  // Suppress pushState when handling popstate (back/forward)
  const suppressPush = useRef(false)

  // Listen for browser back/forward
  useEffect(() => {
    const onPopState = () => {
      suppressPush.current = true
      setRoute(parseLocation())
      // Reset flag after React processes the state update
      requestAnimationFrame(() => { suppressPush.current = false })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  /**
   * Navigate to a new view. Pushes to browser history unless it's
   * a popstate-triggered update.
   */
  const navigate = useCallback((view, param = null) => {
    const newRoute = { view, param }
    setRoute(newRoute)

    if (!suppressPush.current) {
      const path = buildPath(view, param)
      const currentPath = window.location.pathname
      // Only push if the path actually changed
      if (path !== currentPath) {
        window.history.pushState({ view, param }, '', path)
      }
    }
  }, [])

  /**
   * Navigate to chat view with an optional agent.
   */
  const navigateToChat = useCallback((agentId = null) => {
    navigate('chat', agentId)
  }, [navigate])

  /**
   * Navigate to an overlay view (help, settings, profile, data-source).
   */
  const navigateToOverlay = useCallback((overlay, param = null) => {
    navigate(overlay, param)
  }, [navigate])

  /**
   * Go back in browser history.
   */
  const goBack = useCallback(() => {
    window.history.back()
  }, [])

  /**
   * Resolve the initial route's agent param to an actual agent object.
   * Returns null if no agent param or agent not found.
   */
  const resolveInitialAgent = useCallback(() => {
    if (route.view === 'chat' && route.param) {
      return getAgentById(route.param)
    }
    return null
  }, [route, getAgentById])

  return {
    /** Current route descriptor: { view, param } */
    route,
    /** Navigate to any view */
    navigate,
    /** Navigate to chat with optional agentId */
    navigateToChat,
    /** Navigate to an overlay */
    navigateToOverlay,
    /** Browser back */
    goBack,
    /** Resolve agent from initial URL */
    resolveInitialAgent,
  }
}
