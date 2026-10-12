import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_QUERY_KEY, pollInterval, reloadsOnChange, useInactive, useLiveUpdates } from './live.ts'

const live = vi.hoisted(() => ({ changedAt: '2026-10-12T00:00:00Z' }))

vi.mock('./db.ts', async () => {
  const { createFakeDb, ok } = await import('../features/public/testDb.ts')
  const fake = createFakeDb((call) => (call.table === 'live_state' ? ok({ changed_at: live.changedAt, poll_seconds: 30 }) : ok(null)))
  return { publicDb: fake.db }
})

afterEach(cleanup)

describe('pollInterval', () => {
  it('follows poll_seconds', () => {
    expect(pollInterval({ changed_at: 'x', poll_seconds: 60 }, false)).toBe(60_000)
  })
  it('stops when live updates are off, paused or unknown', () => {
    expect(pollInterval({ changed_at: 'x', poll_seconds: 0 }, false)).toBe(false)
    expect(pollInterval({ changed_at: 'x', poll_seconds: 30 }, true)).toBe(false)
    expect(pollInterval(null, false)).toBe(false)
    expect(pollInterval(undefined, false)).toBe(false)
  })
})

describe('reloadsOnChange', () => {
  it('reloads public lists and the studio list and status', () => {
    expect(reloadsOnChange(['public', 'search_posts', 'club'])).toBe(true)
    expect(reloadsOnChange(['studio', 'posts', 'org'])).toBe(true)
    expect(reloadsOnChange(['studio', 'access', 'u', 's'])).toBe(true)
  })
  it('never reloads the post in the edit form or the check itself', () => {
    expect(reloadsOnChange(['studio', 'post', 'org', 'id'])).toBe(false)
    expect(reloadsOnChange(LIVE_QUERY_KEY)).toBe(false)
  })
})

describe('useLiveUpdates', () => {
  it('reloads the lists only when changed_at moves', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const listFn = vi.fn(async () => 'cards')
    function Page() {
      useLiveUpdates()
      useQuery({ queryKey: ['public', 'list'], queryFn: listFn, staleTime: Infinity })
      return null
    }
    render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(client.getQueryData(LIVE_QUERY_KEY)).toBeTruthy())
    expect(listFn).toHaveBeenCalledTimes(1)

    // Same value: nothing reloads.
    await act(() => client.refetchQueries({ queryKey: LIVE_QUERY_KEY }))
    expect(listFn).toHaveBeenCalledTimes(1)

    live.changedAt = '2026-10-12T00:05:00Z'
    await act(() => client.refetchQueries({ queryKey: LIVE_QUERY_KEY }))
    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(2))
  })
})

describe('useInactive', () => {
  it('turns on after the limit without input and off at the next input', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>
    const { result } = renderHook(() => useInactive(50), { wrapper })
    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
    act(() => {
      fireEvent.keyDown(window, { key: 'a' })
    })
    expect(result.current).toBe(false)
  })
})
