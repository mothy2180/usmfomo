// Automatic sign-out after 30 minutes without input, ported from the owner
// console (apps/admin/src/lib/idle.ts). A warning appears two minutes before
// (WCAG 2.2.1: one action extends it).
//
// Unlike the console's memory-only session, the studio session is kept in
// sessionStorage, and the browser brings that back when a closed tab is
// reopened or a browser session is restored. So the time of the last input is
// kept there too, and session.ts signs a session out before it is used when
// its tab has gone without input for longer than the limit.
import { useCallback, useEffect, useRef, useState } from 'react'

export const IDLE_LIMIT_MS = 30 * 60_000
export const IDLE_WARNING_MS = 2 * 60_000
/** Input is saved to sessionStorage at most this often. */
export const ACTIVITY_SAVE_MS = 10_000

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

// ---------------------------------------------------------------------------
// The last input in this tab (sessionStorage, next to the session)
// ---------------------------------------------------------------------------

const LAST_ACTIVITY_KEY = 'usmfomo.studio.lastActivity'

/** When this tab last had input, or null when unknown (never saved, or storage blocked). */
export function readLastActivity(): number | null {
  try {
    const at = Number(window.sessionStorage.getItem(LAST_ACTIVITY_KEY))
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

export function saveLastActivity(at: number = Date.now()): void {
  try {
    window.sessionStorage.setItem(LAST_ACTIVITY_KEY, String(at))
  } catch {
    // storage blocked: the session can't be kept either
  }
}

/** True when this tab has gone without input for the limit or longer. An
 * unknown time counts as too long: such a session must not be used. */
export function idleExpired(lastActivity: number | null, now: number = Date.now(), limitMs = IDLE_LIMIT_MS): boolean {
  return lastActivity === null || now - lastActivity >= limitMs
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

type IdleState = { phase: 'active' } | { phase: 'warning'; remainingMs: number }

/**
 * Tracks input on the whole window. The timestamp check (not a single long
 * timer) survives background-tab timer throttling: the deadline is enforced on
 * the next tick or as soon as the tab becomes visible again. The idle time
 * belongs to the tab, not the page: it carries on from the saved last input.
 */
export function useIdleTimeout(opts: { enabled: boolean; onExpire: () => void; limitMs?: number; warningMs?: number }) {
  const { enabled, limitMs = IDLE_LIMIT_MS, warningMs = IDLE_WARNING_MS } = opts
  const lastActivity = useRef(0)
  const lastSaved = useRef(0)
  const onExpire = useRef(opts.onExpire)
  const [state, setState] = useState<IdleState>({ phase: 'active' })

  useEffect(() => {
    onExpire.current = opts.onExpire
  })

  // Input: in memory at once, in sessionStorage at most every ACTIVITY_SAVE_MS.
  const record = useCallback((t: number, save = false) => {
    lastActivity.current = t
    if (save || t - lastSaved.current >= ACTIVITY_SAVE_MS) {
      lastSaved.current = t
      saveLastActivity(t)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const now = Date.now()
    const saved = readLastActivity()
    record(saved !== null && saved <= now ? saved : now, true)
    let expired = false
    let lastMove = 0

    const touch = () => record(Date.now())
    // Pointer movement counts too, but at most every 5 s.
    const move = () => {
      const t = Date.now()
      if (t - lastMove > 5_000) {
        lastMove = t
        record(t)
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
    // The saved input may already be old: don't wait a tick to act on it.
    check()
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, touch, { capture: true })
      window.removeEventListener('pointermove', move)
      document.removeEventListener('visibilitychange', check)
      window.clearInterval(id)
      setState({ phase: 'active' })
    }
  }, [enabled, limitMs, warningMs, record])

  const stayActive = useCallback(() => {
    record(Date.now(), true)
    setState({ phase: 'active' })
  }, [record])

  return { state, stayActive }
}
