// Live updates without Realtime (0054_live_state.sql). Open pages read one
// tiny row every poll_seconds and reload their lists only when changed_at
// moves. Hidden tabs don't poll (TanStack pauses refetchInterval in the
// background), and a tab with no input for 30 minutes stops until the next
// input, so a lab PC left on the dashboard doesn't poll all day.
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { publicDb } from './db.ts'

export const LIVE_QUERY_KEY = ['live'] as const
export const LIVE_IDLE_MS = 30 * 60_000

export type LiveState = { changed_at: string; poll_seconds: number }

/** Milliseconds between checks, or false for none. */
export function pollInterval(state: LiveState | null | undefined, paused: boolean): number | false {
  if (paused || !state || state.poll_seconds <= 0) return false
  return state.poll_seconds * 1000
}

/** What a change reloads: every public list, and the studio's own post list
 * and status. Never the post open in the edit form. */
export function reloadsOnChange(queryKey: QueryKey): boolean {
  if (queryKey[0] === 'public') return true
  return queryKey[0] === 'studio' && (queryKey[1] === 'posts' || queryKey[1] === 'access')
}

async function fetchLiveState(signal: AbortSignal): Promise<LiveState | null> {
  const { data, error } = await publicDb.from('live_state').select('changed_at,poll_seconds').eq('id', 1).abortSignal(signal).maybeSingle()
  if (error) throw error
  return data
}

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'pointermove'] as const

/** True once the window has had no input for `limitMs`; false again on the next input. */
export function useInactive(limitMs = LIVE_IDLE_MS): boolean {
  const [inactive, setInactive] = useState(false)
  useEffect(() => {
    let last = Date.now()
    const touch = () => {
      last = Date.now()
      setInactive(false)
    }
    const check = () => setInactive(Date.now() - last >= limitMs)
    for (const e of INPUT_EVENTS) window.addEventListener(e, touch, { capture: true, passive: true })
    const id = window.setInterval(check, Math.min(limitMs, 30_000))
    return () => {
      for (const e of INPUT_EVENTS) window.removeEventListener(e, touch, { capture: true })
      window.clearInterval(id)
    }
  }, [limitMs])
  return inactive
}

/** Polls live_state and reloads the affected queries when it changes.
 * Returns whether polling is paused for inactivity (for the banner). */
export function useLiveUpdates(): { paused: boolean } {
  const queryClient = useQueryClient()
  const inactive = useInactive()
  const live = useQuery({
    queryKey: LIVE_QUERY_KEY,
    queryFn: ({ signal }) => fetchLiveState(signal),
    staleTime: 0,
    refetchInterval: (query) => pollInterval(query.state.data, inactive),
  })
  const changedAt = live.data?.changed_at
  const seen = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!changedAt) return
    // The first value is only the baseline: the lists were just loaded.
    if (seen.current !== undefined && seen.current !== changedAt) {
      void queryClient.invalidateQueries({ predicate: (q) => reloadsOnChange(q.queryKey) })
    }
    seen.current = changedAt
  }, [changedAt, queryClient])

  // Back from a pause: check at once instead of waiting a full interval.
  const wasInactive = useRef(false)
  useEffect(() => {
    if (wasInactive.current && !inactive) void queryClient.invalidateQueries({ queryKey: LIVE_QUERY_KEY })
    wasInactive.current = inactive
  }, [inactive, queryClient])

  return { paused: inactive && (live.data?.poll_seconds ?? 0) > 0 }
}
