import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '../lib/api.ts'
import { AccountCheckError } from '../lib/messages.ts'
import { NOTICES, useSession, type Session } from '../lib/sessionContext.ts'
import { IdleGuard } from './IdleGuard.tsx'
import { SessionProvider } from './SessionProvider.tsx'

// A fake Supabase client and owner-admin: no network, no database.
const db = vi.hoisted(() => {
  const listeners = new Set<(event: string) => void>()
  return {
    listeners,
    rpc: vi.fn(),
    aal: vi.fn(),
    listFactors: vi.fn(),
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
      mfa: { getAuthenticatorAssuranceLevel: db.aal, listFactors: db.listFactors },
    },
  },
  adminApi: { status: db.status },
}))

const MIN = 60_000
const OWNER = { data: { state: 'owner', username: 'owner' }, error: null }
const CLUB = { data: { state: 'ok', username: 'robotics-club' }, error: null }
const RPC_DOWN = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }

function setAal(level: 'aal1' | 'aal2') {
  db.aal.mockResolvedValue({ data: { currentLevel: level, nextLevel: 'aal2' }, error: null })
}

function setFactors(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `factor-${i + 1}`,
    friendly_name: `Device ${i + 1}`,
    created_at: `2026-10-0${i + 1}T00:00:00Z`,
    factor_type: 'totp',
    status: 'verified',
  }))
  db.listFactors.mockResolvedValue({ data: { totp: rows, all: rows }, error: null })
}

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

/** Owner at aal2 whose status check succeeds: owner-admin confirmed the owner. */
async function signInConfirmedOwner(devices: number) {
  db.rpc.mockResolvedValue(OWNER)
  setAal('aal2')
  setFactors(devices)
  db.status.mockResolvedValue({})
  expect(await signIn()).toBeNull()
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
    // Never routed to the owner's code or enrolment step.
    expect(db.aal).not.toHaveBeenCalled()
  })

  it('treats an unexpected answer as unknown, without a retry', async () => {
    db.rpc.mockResolvedValue({ data: { state: 'anonymous' }, error: null })
    renderProvider()
    expect(await signIn()).toBeInstanceOf(AccountCheckError)
    expect(db.rpc).toHaveBeenCalledTimes(1)
    expect(scopes()).toEqual(['local'])
    expect(db.aal).not.toHaveBeenCalled()
  })

  it('continues for the owner when the retry succeeds', async () => {
    db.rpc.mockResolvedValueOnce(RPC_DOWN).mockResolvedValue(OWNER)
    setAal('aal1')
    setFactors(2)
    renderProvider()
    expect(await signIn()).toBeNull()
    expect(session.phase.kind).toBe('challenge')
    expect(db.signOut).not.toHaveBeenCalled()
  })

  it('signs a club account out locally as "not the owner"', async () => {
    db.rpc.mockResolvedValue(CLUB)
    renderProvider()
    expect(await signIn()).toBeNull()
    expect(session.phase.kind).toBe('not_owner')
    expect(scopes()).toEqual(['local'])
    expect(db.aal).not.toHaveBeenCalled()
  })
})

describe('sign-out scope', () => {
  it('is local before owner-admin has confirmed the owner', async () => {
    db.rpc.mockResolvedValue(OWNER)
    setAal('aal1')
    setFactors(1)
    renderProvider()
    await signIn()
    expect(session.phase.kind).toBe('challenge')
    await act(() => session.signOut())
    expect(scopes()).toEqual(['local'])
    expect(session.phase).toEqual({ kind: 'signed_out', notice: NOTICES.signedOut })
  })

  it('is global once owner-admin has confirmed the owner, and local again after that session', async () => {
    renderProvider()
    await signInConfirmedOwner(2)
    expect(session.phase.kind).toBe('ready')
    await act(() => session.signOut())
    expect(scopes()).toEqual(['global'])

    // A new sign-in that only reaches the code step starts unconfirmed again.
    setAal('aal1')
    await signIn()
    expect(session.phase.kind).toBe('challenge')
    await act(() => session.signOut())
    expect(scopes()).toEqual(['global', 'local'])
  })

  it('stays local in limited mode (owner-admin could not confirm the owner)', async () => {
    db.rpc.mockResolvedValue(OWNER)
    setAal('aal2')
    setFactors(2)
    db.status.mockRejectedValue(new AdminApiError('status', 'unavailable', 503))
    renderProvider()
    await signIn()
    expect(session.phase.kind).toBe('status_error')
    await act(() => session.continueLimited())
    expect(session.phase.kind).toBe('ready')
    await act(() => session.signOut())
    expect(scopes()).toEqual(['local'])
  })

  it('makes the idle guard sign out locally before confirmation', async () => {
    vi.useFakeTimers()
    db.rpc.mockResolvedValue(OWNER)
    setAal('aal1')
    setFactors(1)
    renderProvider(<IdleGuard />)
    await signIn()
    expect(session.phase.kind).toBe('challenge')
    await act(async () => {
      vi.advanceTimersByTime(30 * MIN + 1000)
    })
    expect(scopes()).toEqual(['local'])
    expect(session.phase).toEqual({ kind: 'signed_out', notice: NOTICES.idle })
  })

  it('makes the idle guard sign out globally for a confirmed owner', async () => {
    vi.useFakeTimers()
    renderProvider(<IdleGuard />)
    await signInConfirmedOwner(2)
    expect(session.phase.kind).toBe('ready')
    await act(async () => {
      vi.advanceTimersByTime(30 * MIN + 1000)
    })
    expect(scopes()).toEqual(['global'])
    expect(session.phase).toEqual({ kind: 'signed_out', notice: NOTICES.idle })
  })
})

describe('two TOTP devices before the console', () => {
  it('stays on the second-device step until Auth lists two verified devices', async () => {
    renderProvider()
    await signInConfirmedOwner(1)
    expect(session.phase.kind).toBe('second_device')
    // There is no skip: continuing with one device keeps the step.
    await act(() => session.continueToConsole())
    expect(session.phase.kind).toBe('second_device')
    setFactors(2)
    await act(() => session.continueToConsole())
    expect(session.phase.kind).toBe('ready')
  })

  it('does not assume two devices when Auth cannot list them', async () => {
    renderProvider()
    await signInConfirmedOwner(2)
    await act(() => session.signOut())
    db.listFactors.mockResolvedValue({ data: null, error: { message: 'Auth unavailable', status: 503 } })
    await signIn()
    expect(session.phase.kind).toBe('second_device')
  })

  it('requires two devices in limited mode too', async () => {
    db.rpc.mockResolvedValue(OWNER)
    setAal('aal2')
    setFactors(1)
    db.status.mockRejectedValue(new AdminApiError('status', 'unavailable', 503))
    renderProvider()
    await signIn()
    await act(() => session.continueLimited())
    expect(session.phase.kind).toBe('second_device')
  })
})
