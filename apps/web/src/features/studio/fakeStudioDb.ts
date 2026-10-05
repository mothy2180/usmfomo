// Test-only stand-in for studioDb (lib/db.ts), used through vi.mock: the auth
// methods the studio calls, my_posting_status via rpc(), and an event bus for
// onAuthStateChange. Each method is a vi.fn, so tests can script answers.
import { vi } from 'vitest'

type Listener = (event: string, session: FakeSession | null) => void
export type FakeSession = { access_token: string; user: { id: string } }
type Result = { data: unknown; error: unknown }

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

/** A session whose access token carries the claims session.ts reads. */
export function fakeSession(aal: 'aal1' | 'aal2' = 'aal1', userId = 'user-1'): FakeSession {
  return { access_token: `${b64url({ alg: 'none' })}.${b64url({ aal, session_id: 'sess-1', sub: userId })}.sig`, user: { id: userId } }
}

export const ORG = { id: '11111111-1111-4111-8111-111111111111', name: 'Kelab Robotik', slug: 'robotik', type: 'club', campus: 'engineering' } as const

/** my_posting_status() for an account that may post. */
export function okStatusJson(over: Record<string, unknown> = {}) {
  return {
    state: 'ok',
    username: 'robotik',
    org: ORG,
    posting_enabled: true,
    live: 2,
    live_limit: 15,
    new_24h: 1,
    new_limit: 5,
    next_slot_at: null,
    edits_24h: 0,
    edits_limit: 30,
    factors: 0,
    ...over,
  }
}

const aal = (currentLevel: string, nextLevel: string): Result => ({ data: { currentLevel, nextLevel, currentAuthenticationMethods: [] }, error: null })

export function createFakeStudioDb() {
  let session: FakeSession | null = null
  const listeners = new Set<Listener>()
  const emit = (event: string) => {
    for (const l of listeners) l(event, session)
  }
  const auth = {
    getSession: vi.fn(async (): Promise<Result> => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listeners.add(cb)
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
    }),
    signInWithPassword: vi.fn(async (_params: unknown): Promise<Result> => ({ data: {}, error: null })),
    signOut: vi.fn(async (_options?: unknown): Promise<{ error: unknown }> => {
      session = null
      emit('SIGNED_OUT')
      return { error: null }
    }),
    refreshSession: vi.fn(async (): Promise<Result> => ({ data: {}, error: null })),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(async (): Promise<Result> => aal('aal1', 'aal1')),
      listFactors: vi.fn(async (): Promise<Result> => ({ data: { all: [], totp: [] }, error: null })),
      enroll: vi.fn(async (_params: unknown): Promise<Result> => ({ data: null, error: { code: 'unexpected' } })),
      challengeAndVerify: vi.fn(async (_params: unknown): Promise<Result> => ({ data: {}, error: null })),
      unenroll: vi.fn(async (_params: unknown): Promise<Result> => ({ data: {}, error: null })),
    },
  }
  const rpc = vi.fn(async (_fn: string): Promise<Result> => ({ data: { state: 'anonymous' }, error: null }))
  return {
    db: { auth, rpc },
    /** Sets the session (as if Auth changed it) and notifies listeners. */
    setSession(next: FakeSession | null, event = 'SIGNED_IN') {
      session = next
      emit(event)
    },
    aal,
  }
}

export type FakeStudioDb = ReturnType<typeof createFakeStudioDb>
