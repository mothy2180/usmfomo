import { useEffect, useRef, useState } from 'react'
import { loadTurnstile, turnstileSize } from '../lib/turnstile.ts'

type Props = {
  siteKey: string
  /** Called with a fresh token, or null when it expires or fails. */
  onToken: (token: string | null) => void
  /** Increment to get a new token (each token is single-use). */
  resetKey: number
}

/** Cloudflare Turnstile widget (explicit render). Supabase Auth verifies the
 * token server-side; the browser only passes it along with the sign-in. */
export function Turnstile({ siteKey, onToken, resetKey }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  const [problem, setProblem] = useState<'load' | 'challenge' | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    onTokenRef.current = onToken
  })

  useEffect(() => {
    let cancelled = false
    loadTurnstile().then(
      (ts) => {
        const el = box.current
        if (cancelled || !el) return
        setProblem(null)
        widget.current =
          ts.render(el, {
            sitekey: siteKey,
            action: 'owner_login',
            theme: 'dark',
            language: 'en',
            size: turnstileSize(el.clientWidth),
            callback: (token) => {
              setProblem(null)
              onTokenRef.current(token)
            },
            'expired-callback': () => onTokenRef.current(null),
            'timeout-callback': () => onTokenRef.current(null),
            'error-callback': () => {
              onTokenRef.current(null)
              setProblem('challenge')
            },
          }) ?? null
      },
      () => {
        if (!cancelled) setProblem('load')
      },
    )
    return () => {
      cancelled = true
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [siteKey, attempt])

  const firstReset = useRef(resetKey)
  useEffect(() => {
    if (resetKey === firstReset.current) return
    onTokenRef.current(null)
    if (widget.current) window.turnstile?.reset(widget.current)
  }, [resetKey])

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} className="min-h-[65px] w-full" />
      {problem === 'load' ? (
        <p role="alert" className="m-0 text-sm text-danger">
          The security check couldn't load. Check your connection or content blockers, then{' '}
          <button type="button" className="min-h-6 underline" onClick={() => setAttempt((a) => a + 1)}>
            try again
          </button>
          .
        </p>
      ) : null}
      {problem === 'challenge' ? (
        <p role="alert" className="m-0 text-sm text-danger">
          The security check failed. It retries by itself; if it keeps failing, reload the page.
        </p>
      ) : null}
    </div>
  )
}
