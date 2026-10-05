import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/** Tailwind's `lg` breakpoint (64rem): both panels side by side from here. */
export const WIDE_QUERY = '(min-width: 64rem)'

/** The current time, refreshed every `intervalMs`, so sections and "Happening
 * now" badges move on while the page stays open. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatch()) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => canMatch() && window.matchMedia(query).matches,
    () => false,
  )
}

/** Sets document.title while the page is shown. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title) document.title = title
  }, [title])
}
