// Cloudflare Turnstile (the login CAPTCHA). Supabase Auth verifies the token
// server-side (captchaToken); this module only renders the widget.
//
// CSP: the script and its iframe come from https://challenges.cloudflare.com
// (script-src + frame-src). We add a <script src> element and nothing inline.
import { useCallback, useEffect, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY } from '../env.ts'

export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export type TurnstileRenderOptions = {
  sitekey: string
  action?: string
  theme?: 'light' | 'dark' | 'auto'
  language?: string
  size?: 'normal' | 'flexible' | 'compact'
  appearance?: 'always' | 'execute' | 'interaction-only'
  'response-field'?: boolean
  'refresh-expired'?: 'auto' | 'manual' | 'never'
  retry?: 'auto' | 'never'
  callback?: (token: string) => void
  'expired-callback'?: (token: string) => void
  'timeout-callback'?: () => void
  /** Return true to mark the error handled (no console warning, no throw). */
  'error-callback'?: (code: string) => boolean | void
  'unsupported-callback'?: () => void
}

/** The subset of window.turnstile we use. */
export type TurnstileApi = {
  render: (container: HTMLElement | string, options: TurnstileRenderOptions) => string | null | undefined
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
  getResponse: (widgetId?: string) => string | undefined
  isExpired: (widgetId?: string) => boolean
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null

/** Loads api.js once per page; later calls share the same promise. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      // Allow a later retry to insert a fresh script element.
      script.remove()
      loading = null
      reject(new Error('turnstile_unavailable'))
    }
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.addEventListener('load', () => {
      if (window.turnstile) resolve(window.turnstile)
      else fail()
    })
    script.addEventListener('error', fail)
    document.head.appendChild(script)
  })
  return loading
}

/** Flexible (full width, >= 300 px) when it fits, else compact (150 px), so
 * the login form still reflows at 320 CSS px (WCAG 1.4.10). */
export function widgetSize(containerWidth: number): 'flexible' | 'compact' {
  return containerWidth >= 300 ? 'flexible' : 'compact'
}

export type WidgetEvents = {
  onToken: (token: string) => void
  onExpire: () => void
  onError: (code: string) => void
}

/** Render options for our widget: dark theme to match the UI, the page's
 * language, no hidden form field (we pass the token to Supabase ourselves). */
export function widgetOptions(
  action: string,
  language: 'en' | 'ms',
  containerWidth: number,
  events: WidgetEvents,
): TurnstileRenderOptions {
  return {
    sitekey: TURNSTILE_SITE_KEY,
    action,
    theme: 'dark',
    language,
    size: widgetSize(containerWidth),
    'response-field': false,
    'refresh-expired': 'auto',
    callback: events.onToken,
    'expired-callback': () => events.onExpire(),
    'timeout-callback': () => events.onExpire(),
    'error-callback': (code) => {
      events.onError(String(code))
      return true
    },
    'unsupported-callback': () => events.onError('unsupported'),
  }
}

export type TurnstileStatus = 'loading' | 'ready' | 'solved' | 'error'

export type TurnstileHandle = {
  /** Callback ref for the element the widget renders into: ref={handle.attach}. */
  attach: (el: HTMLDivElement | null) => void
  /** Current single-use token, or null until the check passes. */
  token: string | null
  status: TurnstileStatus
  /** Get a fresh token (call after every failed sign-in attempt). */
  reset: () => void
  /** After an error: reload the widget from scratch. */
  retry: () => void
}

/**
 * Renders a Turnstile widget into the `attach`ed element and tracks its
 * token. Tokens are single-use and expire after 300 s: call `reset()` after
 * each sign-in attempt that keeps the user on the page.
 */
export function useTurnstile(action: string, language: 'en' | 'ms'): TurnstileHandle {
  // A state-backed callback ref: the widget renders whenever the container
  // element appears, even if it mounts after the first effect run.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const widgetRef = useRef<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<TurnstileStatus>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!container) return
    let cancelled = false
    loadTurnstile()
      .then((ts) => {
        if (cancelled) return
        const id = ts.render(
          container,
          widgetOptions(action, language, container.clientWidth, {
            onToken: (t) => {
              setToken(t)
              setStatus('solved')
            },
            onExpire: () => {
              setToken(null)
              setStatus('ready')
            },
            onError: () => {
              setToken(null)
              setStatus('error')
            },
          }),
        )
        widgetRef.current = id ?? null
        setStatus((s) => (s === 'loading' ? 'ready' : s))
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
      // The next widget (new language, retry, new container) starts afresh.
      setToken(null)
      setStatus('loading')
      const id = widgetRef.current
      widgetRef.current = null
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id)
        } catch {
          // already gone
        }
      }
    }
  }, [container, action, language, attempt])

  const reset = useCallback(() => {
    setToken(null)
    const id = widgetRef.current
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id)
        setStatus('ready')
        return
      } catch {
        // fall through to a full reload
      }
    }
    setAttempt((n) => n + 1)
  }, [])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { attach: setContainer, token, status, reset, retry }
}
