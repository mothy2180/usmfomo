// Automatic sign-out after 30 minutes without input. A warning appears two
// minutes before (WCAG 2.2.1: the owner can extend with one action).
import { useCallback, useEffect, useRef, useState } from 'react'

export const IDLE_LIMIT_MS = 30 * 60_000
export const IDLE_WARNING_MS = 2 * 60_000

export type IdlePhase = 'active' | 'warning' | 'expired'

export function idlePhase(idleMs: number, limitMs = IDLE_LIMIT_MS, warningMs = IDLE_WARNING_MS): IdlePhase {
  if (idleMs >= limitMs) return 'expired'
  if (idleMs >= limitMs - warningMs) return 'warning'
  return 'active'
}

/** "1:05" for the countdown. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

type IdleState = { phase: 'active' } | { phase: 'warning'; remainingMs: number }

/**
 * Tracks input on the whole window. The timestamp check (not a single long
 * timer) survives background-tab timer throttling: the deadline is enforced on
 * the next tick or as soon as the tab becomes visible again.
 */
export function useIdleTimeout(opts: { enabled: boolean; onExpire: () => void; limitMs?: number; warningMs?: number }) {
  const { enabled, limitMs = IDLE_LIMIT_MS, warningMs = IDLE_WARNING_MS } = opts
  const lastActivity = useRef(0)
  const onExpire = useRef(opts.onExpire)
  const [state, setState] = useState<IdleState>({ phase: 'active' })

  useEffect(() => {
    onExpire.current = opts.onExpire
  })

  useEffect(() => {
    if (!enabled) return
    lastActivity.current = Date.now()
    let expired = false
    let lastMove = 0

    const touch = () => {
      lastActivity.current = Date.now()
    }
    // Pointer movement counts too, but at most every 5 s.
    const move = () => {
      const t = Date.now()
      if (t - lastMove > 5_000) {
        lastMove = t
        lastActivity.current = t
      }
    }
    const check = () => {
      if (expired) return
      const idle = Date.now() - lastActivity.current
      const phase = idlePhase(idle, limitMs, warningMs)
      if (phase === 'expired') {
        expired = true
        onExpire.current()
      } else if (phase === 'warning') {
        const remainingMs = Math.ceil((limitMs - idle) / 1000) * 1000
        setState((prev) => (prev.phase === 'warning' && prev.remainingMs === remainingMs ? prev : { phase: 'warning', remainingMs }))
      } else {
        setState((prev) => (prev.phase === 'active' ? prev : { phase: 'active' }))
      }
    }

    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, touch, { capture: true, passive: true })
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('visibilitychange', check)
    const id = window.setInterval(check, 1_000)
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, touch, { capture: true })
      window.removeEventListener('pointermove', move)
      document.removeEventListener('visibilitychange', check)
      window.clearInterval(id)
      setState({ phase: 'active' })
    }
  }, [enabled, limitMs, warningMs])

  const stayActive = useCallback(() => {
    lastActivity.current = Date.now()
    setState({ phase: 'active' })
  }, [])

  return { state, stayActive }
}
