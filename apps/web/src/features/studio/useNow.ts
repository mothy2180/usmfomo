import { useEffect, useState } from 'react'

/** The current time, refreshed every `intervalMs`, so labels such as
 * "Happening now" or "next slot 14:20" move on while the page stays open. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
