import { useEffect, useState, useSyncExternalStore } from 'react'
import { REDUCED_MOTION_QUERY } from './gating.ts'

const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribeReducedMotion(onChange: () => void): () => void {
  if (!canMatch()) return () => {}
  const mql = window.matchMedia(REDUCED_MOTION_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** prefers-reduced-motion, live (it can change while the page is open). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => canMatch() && window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  )
}

/** False until the page has painted and the browser is idle (or 1.5 s passed),
 * so the 3D chunk never competes with the first paint of the static page. */
export function useIdle(timeoutMs = 1500): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setIdle(true), { timeout: timeoutMs })
      return () => window.cancelIdleCallback(id)
    }
    // Safari has no requestIdleCallback.
    const id = window.setTimeout(() => setIdle(true), 200)
    return () => window.clearTimeout(id)
  }, [timeoutMs])
  return idle
}
