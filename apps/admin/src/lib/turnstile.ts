// Cloudflare Turnstile, loaded on demand with explicit rendering. The admin CSP
// allows script-src and frame-src https://challenges.cloudflare.com and nothing
// else from Cloudflare; the script must come from this exact URL (no proxying).

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export type TurnstileRenderOptions = {
  sitekey: string
  /** Up to 32 characters of [A-Za-z0-9_-]; shown in Turnstile analytics. */
  action?: string
  theme?: 'auto' | 'light' | 'dark'
  size?: 'normal' | 'flexible' | 'compact'
  language?: string
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'timeout-callback'?: () => void
  'error-callback'?: (code: string) => void
}

export type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined
  reset(widgetId?: string): void
  remove(widgetId?: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let pending: Promise<TurnstileApi> | null = null

/** Loads api.js once; a failed load can be retried by calling again. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (pending) return pending
  pending = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (window.turnstile) {
        resolve(window.turnstile)
      } else {
        pending = null
        reject(new Error('turnstile_unavailable'))
      }
    }
    script.onerror = () => {
      pending = null
      script.remove()
      reject(new Error('turnstile_load_failed'))
    }
    document.head.append(script)
  })
  return pending
}

/** Turnstile's "normal"/"flexible" widgets need 300 px; narrower containers
 * (a 320 px phone with gutters) get the compact one so nothing overflows. */
export function turnstileSize(containerWidth: number): 'flexible' | 'compact' {
  return containerWidth > 0 && containerWidth < 300 ? 'compact' : 'flexible'
}
