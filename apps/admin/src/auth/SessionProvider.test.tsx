import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '../lib/api.ts'
import { AccountCheckError } from '../lib/messages.ts'
import { NOTICES, useSession, type Session } from '../lib/sessionContext.ts'
import { reportSessionProblem } from '../lib/sessionEvents.ts'
import { IdleGuard } from './IdleGuard.tsx'
import { SessionProvider } from './SessionProvider.tsx'

// A fake Supabase client and owner-admin: no network, no database.
const db = vi.hoisted(() => {
  const listeners = new Set<(event: string) => void>()
  return {
    listeners,
    rpc: vi.fn(),
    status: vi.fn(),
    // Like supabase-js: dropping the session emits SIGNED_OUT.
    signOut: vi.fn(async (_options: { scope: 'global' | 'local' }) => {
      for (const listener of listeners) listener('SIGNED_OUT')
      return { error: null }
    }),
  }
})

vi.mock('../lib/db.ts', () => ({
  ownerDb: {
    rpc: db.rpc,
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: db.signOut,
      onAuthStateChange: (listener: (event: string) => void) => {
        db.listeners.add(listener)
        return { data: { subscription: { unsubscribe: () => db.listeners.delete(listener) } } }
      },
    },
  },
  adminApi: { status: db.status },
}))

const MIN = 60_000
const OWNER = { data: { state: 'owner', username: 'owner' }, error: null }
const CLUB = { data: { state: 'ok', username: 'robotics-club' }, error: null }
const RPC_DOWN = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }

let session: Session

/** Hands the latest session to the test (act() flushes the effect). */
function Capture() {
  const current = useSession()
  useEffect(() => {
    session = current
  })
  return null
}

function renderProvider(extra?: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Capture />
        {extra}
      </SessionProvider>
    </QueryClientProvider>,
  )
}

async function signIn(): Promise<unknown> {
  let failure: unknown = null
  await act(async () => {
    await session.signIn('owner', 'a-long-password', 'turnstile-token').catch((err: unknown) => {
      failure = err
    })
  })
  return failure
}

/** Owner whose status check succeeds: owner-admin confirmed the owner. */
async function signInConfirmedOwner() {
  db.rpc.mockResolvedValue(OWNER)
  db.status.mockResolvedValue({})
  expect(await signIn()).toBeNull()
}

/** Owner whose status check fails (owner-admin down): not confirmed. */
async function signInUnconfirmedOwner() {
  db.rpc.mockResolvedValue(OWNER)
  db.status.mockRejectedValue(new AdminApiError('status', 'unavailable', 503))
  expect(await signIn()).toBeNull()
  expect(session.phase).toMatchObject({ kind: 'status_error', ownerHint: true })
}

const scopes = () => db.signOut.mock.calls.map(([options]) => options.scope)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('sign-in pre-check (my_posting_status)', () => {
  it('fails closed when the check keeps failing: one retry, then a local sign-out and an error', async () => {
    db.rpc.mockResolvedValue(RPC_DOWN)
    renderProvider()
    expect(await signIn()).toBeInstanceOf(AccountCheckError)
    expect(db.rpc).toHaveBeenCalledTimes(2)
    expect(scopes()).toEqual(['local'])
    expect(session.phase.kind).toBe('signed_out')
    // Never reached the owner check.
    expect(db.status).not.toHaveBeenCalled()
  })

  it('treats an unexpected answer as unknown, without a retry', async () => {
    db.rpc.mockResolvedValue({ data: { state: 'anonymous' }, error: null })
    renderProvider()
    expect(await signIn()).toBeInstanceOf(AccountCheckError)
    expect(db.rpc).toHaveBeenCalledTimes(1)
    expect(scopes()).toEqual(['local'])
    expect(db.status).not.toHaveBeenCalled()
  })

  it('continues for the owner when the retry succeeds', async () => {
    db.rpc.mockResolvedValueOnce(RPC_DOWN).mockResolvedValue(OWNER)
    db.status.mockResolvedValue({})
    renderProvider()
    expect(await signIn()).toBeNull()
    expect(session.phase.kind).toBe('ready')
    expect(db.signOut).not.toHaveBeenCalled()
  })

  it('signs a club account out locally as "not the owner"', async () => {
    db.rpc.mockResolvedValue(CLUB)
    renderProvider()
    expect(await signIn()).toBeNull()
    expect(session.phase.kind).toBe('not_owner')
    expect(scopes()).toEqual(['local'])
    expect(db.status).not.toHaveBeenCalled()
  })
})

describe('sign-in to the console', () => {
  it('opens the console straight after the password once owner-admin confirms the owner', async () => {
    renderProvider()
    await signInConfirmedOwner()
    expect(db.status).toHaveBeenCalledTimes(1)
    expect(session.phase.kind).toBe('ready')
    expect(session.username).toBe('owner')
    expect(db.signOut).not.toHaveBeenCalled()
  })

  it('signs out locally as "not the owner" when owner-admin refuses', async () => {
    db.rpc.mockResolvedValue(OWNER)
    db.status.mockRejectedValue(new AdminApiError('status', 'forbidden', 403))
    renderProvider()
    expect(await signIn()).toBeNull()
    expect(session.phase.kind).toBe('not_owner')
    expect(scopes()).toEqual(['local'])
  })

  it('signs out locally when owner-admin says the session has ended', async () => {
    db.rpc.mockResolvedValue(OWNER)
    db.status.mockRejectedValue(new AdminApiError('status', 'unauthorized', 401))
    renderProvider()
    expect(await signIn()).toBeNull()
    expect(session.phase).toEqual({ kind: 'signed_out', notice: NOTICES.ended })
    expect(scopes()).toEqual(['local'])
  })

  it('retries the owner check from the error page', async () => {
    renderProvider()
    await signInUnconfirmedOwner()
    db.status.mockResolvedValue({})
    await act(() => session.retryStatus())
    expect(session.phase.kind).toBe('ready')
  })

  it('ends the session when a request reports it ended', async () => {
    renderProvider()
    await signInConfirmedOwner()
    await act(async () => {
      reportSessionProblem({ code: 'PGRST303', message: 'JWT expired' })
    })
    expect(session.phase).toEqual({ kind: 'signed_out', notice: NOTICES.ended })
    expect(scopes()).toEqual(['local'])
  })
})

describe('sign-out scope', () => {
  it('is local before owner-admin has confirmed the owner', async () => {
    renderProvider()
    await signInUnconfirmedOwner()
    await act(() => session.signOut())
    expect(scopes()).toEqual(['local'])
    expect(session.phase).toEqual({ kind: 'signed_out', notice: NOTICES.signedOut })
  })

  it('is global once owner-admin has confirmed the owner, and local again after that session', async () => {
    renderProvider()
    await signInConfirmedOwner()
    expect(session.phase.kind).toBe('ready')
    await act(() => session.signOut())
    expect(scopes()).toEqual(['global'])

    // A new sign-in that owner-admin can't confirm starts unconfirmed again.
    await signInUnconfirmedOwner()
    await act(() => session.signOut())
    expect(scopes()).toEqual(['global', 'local'])
  })

  it('stays local in limited mode (owner-admin could not confirm the owner)', async () => {
    renderProvider()
    await signInUnconfirmedOwner()
    act(() => session.continueLimited())
    expect(session.phase.kind).toBe('ready')
    await act(() => session.signOut())
    expect(scopes()).toEqual(['local'])
  })

  it('makes the idle guard sign out locally before confirmation', async () => {
    vi.useFakeTimers()
    renderProvider(<IdleGuard />)
    await signInUnconfirmedOwner()
    await act(async () => {
      vi.advanceTimersByTime(30 * MIN + 1000)
    })
    expect(scopes()).toEqual(['local'])
    expect(session.phase).toEqual({ kind: 'signed_out', notice: NOTICES.idle })
  })

  it('makes the idle guard sign out globally for a confirmed owner', async () => {
    vi.useFakeTimers()
    renderProvider(<IdleGuard />)
    await signInConfirmedOwner()
    expect(session.phase.kind).toBe('ready')
    await act(async () => {
      vi.advanceTimersByTime(30 * MIN + 1000)
    })
    expect(scopes()).toEqual(['global'])
    expect(session.phase).toEqual({ kind: 'signed_out', notice: NOTICES.idle })
  })
})
