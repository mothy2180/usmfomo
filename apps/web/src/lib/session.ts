// Club studio session: who is signed in, whether they may use the studio,
// and signing out. The database decides (my_posting_status, RLS); this only
// routes the UI. Sessions live in sessionStorage (see db.ts).
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { CAMPUSES, LIMITS, ORG_TYPES, type Campus, type OrgType } from '@usmfomo/shared/config'
import { errorKey } from '@usmfomo/shared/errors'
import { useEffect, useState } from 'react'
import { studioDb } from './db.ts'

/** Every studio query key starts with this, so sign-out can drop them all. */
export const STUDIO_QUERY_KEY = ['studio'] as const

// ---------------------------------------------------------------------------
// my_posting_status()
// ---------------------------------------------------------------------------

export const POSTING_STATES = ['ok', 'mfa_required', 'inactive', 'session_ended', 'no_account', 'owner', 'anonymous'] as const
export type PostingState = (typeof POSTING_STATES)[number]

export type StudioOrg = { id: string; name: string; slug: string; type: OrgType; campus: Campus }

export type OkStatus = {
  state: 'ok'
  username: string
  org: StudioOrg
  posting_enabled: boolean
  live: number
  live_limit: number
  new_24h: number
  new_limit: number
  /** Set only when the daily new-post limit is reached. */
  next_slot_at: string | null
  edits_24h: number
  edits_limit: number
  /** Verified TOTP factors on the account. */
  factors: number
}

export type OtherStatus = { state: Exclude<PostingState, 'ok'>; username: string | null }
export type PostingStatus = OkStatus | OtherStatus

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** Validates the RPC's JSON (typed as Json by the generated types). */
export function parsePostingStatus(json: unknown): PostingStatus {
  if (!isRecord(json) || typeof json.state !== 'string' || !(POSTING_STATES as readonly string[]).includes(json.state)) {
    throw new Error('Unexpected posting status')
  }
  const state = json.state as PostingState
  if (state !== 'ok') return { state, username: str(json.username) }

  const org = json.org
  if (
    !isRecord(org) ||
    typeof org.id !== 'string' ||
    typeof org.name !== 'string' ||
    typeof org.slug !== 'string' ||
    !(ORG_TYPES as readonly unknown[]).includes(org.type) ||
    !(CAMPUSES as readonly unknown[]).includes(org.campus)
  ) {
    throw new Error('Unexpected posting status')
  }
  return {
    state,
    username: str(json.username) ?? '',
    org: { id: org.id, name: org.name, slug: org.slug, type: org.type as OrgType, campus: org.campus as Campus },
    posting_enabled: json.posting_enabled === true,
    live: num(json.live, 0),
    live_limit: num(json.live_limit, LIMITS.livePosts),
    new_24h: num(json.new_24h, 0),
    new_limit: num(json.new_limit, LIMITS.newPostsPer24h),
    next_slot_at: str(json.next_slot_at),
    edits_24h: num(json.edits_24h, 0),
    edits_limit: num(json.edits_limit, LIMITS.editsPer24h),
    factors: num(json.factors, 0),
  }
}

// ---------------------------------------------------------------------------
// The decision (pure)
// ---------------------------------------------------------------------------

export type StudioDecision = 'ok' | 'login' | 'mfa' | 'inactive' | 'owner' | 'ended'
export type AalInfo = { currentLevel: string | null; nextLevel: string | null }

/**
 * Does this session still need a TOTP code? Either supabase-js says so (a
 * verified factor exists, session at aal1) or the database does — it also
 * knows about a factor another committee member added after this session
 * signed in, which the cached user object may not.
 */
export function needsSecondFactor(aal: AalInfo | null, status: { state: PostingState } | null): boolean {
  return (aal?.currentLevel === 'aal1' && aal.nextLevel === 'aal2') || status?.state === 'mfa_required'
}

/**
 * Where a studio page should go:
 *   login    — no session (or the database sees no signed-in user)
 *   owner    — the owner account: it uses the owner console, never the studio
 *   inactive — paused account/org, or the account no longer exists
 *   ended    — the session was revoked (password reset / handover)
 *   mfa      — a verified factor exists but this session is still aal1
 *   ok       — may use the studio
 */
export function decideStudioAccess(
  session: object | null,
  aal: AalInfo | null,
  status: { state: PostingState } | null,
): StudioDecision {
  if (!session) return 'login'
  switch (status?.state) {
    case 'owner':
      return 'owner'
    case 'inactive':
    case 'no_account':
      return 'inactive'
    case 'session_ended':
      return 'ended'
    case 'anonymous':
      return 'login'
    default:
      break
  }
  if (needsSecondFactor(aal, status)) return 'mfa'
  if (status?.state === 'ok') return 'ok'
  return 'ended'
}

/** Claims we key caches on. Reading our own token is not a security check:
 * the database verifies every request. */
export function tokenClaims(accessToken: string): { aal: string | null; sessionId: string | null } {
  try {
    const part = accessToken.split('.')[1] ?? ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!isRecord(payload)) return { aal: null, sessionId: null }
    return { aal: str(payload.aal), sessionId: str(payload.session_id) }
  } catch {
    return { aal: null, sessionId: null }
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

type SessionState = { ready: boolean; session: Session | null }

/** The studio session from sessionStorage, kept current via onAuthStateChange. */
export function useStudioSession(): SessionState {
  const queryClient = useQueryClient()
  const [state, setState] = useState<SessionState>({ ready: false, session: null })

  useEffect(() => {
    let active = true
    void studioDb.auth.getSession().then(({ data }) => {
      if (active) setState({ ready: true, session: data.session })
    })
    // Only set state here: calling other auth methods inside this callback
    // can deadlock supabase-js.
    const { data } = studioDb.auth.onAuthStateChange((event, session) => {
      if (!active) return
      setState({ ready: true, session })
      // Shared lab PCs: drop the club's cached data as soon as it signs out.
      if (event === 'SIGNED_OUT') queryClient.removeQueries({ queryKey: STUDIO_QUERY_KEY })
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [queryClient])

  return state
}

export type StudioAccess =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown; retry: () => void }
  | { phase: 'ready'; decision: 'ok'; status: OkStatus; session: Session }
  | { phase: 'ready'; decision: Exclude<StudioDecision, 'ok'>; status: PostingStatus | null }

type AccessData = { aal: AalInfo; status: PostingStatus }

async function loadAccess(): Promise<AccessData> {
  const [aalRes, statusRes] = await Promise.all([
    studioDb.auth.mfa.getAuthenticatorAssuranceLevel(),
    studioDb.rpc('my_posting_status'),
  ])
  if (aalRes.error) throw aalRes.error
  const aal = { currentLevel: aalRes.data.currentLevel, nextLevel: aalRes.data.nextLevel }
  if (statusRes.error) {
    // An expired or revoked JWT: treat like a revoked session.
    if (errorKey(statusRes.error) === 'session_ended') return { aal, status: { state: 'session_ended', username: null } }
    throw statusRes.error
  }
  return { aal, status: parsePostingStatus(statusRes.data) }
}

/** Query key for the access check: a new user, session or AAL refetches. */
export function accessKey(session: Session | null) {
  const claims = session ? tokenClaims(session.access_token) : null
  return [...STUDIO_QUERY_KEY, 'access', session?.user.id ?? '', claims?.sessionId ?? '', claims?.aal ?? ''] as const
}

/**
 * While the access check refetches for a new key, keep showing the previous
 * answer only if it belongs to the same user. Adding or removing a 2FA device
 * changes the session's AAL; without this the page would unmount into a
 * spinner mid-flow. Never carried over to a different account.
 */
export function keepSameUser<T>(previous: T | undefined, previousKey: readonly unknown[] | undefined, key: readonly unknown[]): T | undefined {
  const user = key[2]
  return previousKey && typeof user === 'string' && user !== '' && previousKey[2] === user ? previous : undefined
}

/** Session + AAL + my_posting_status() -> a decision for studio pages. */
export function useStudioAccess(): StudioAccess {
  const { ready, session } = useStudioSession()
  const queryKey = accessKey(session)
  const query = useQuery({
    queryKey,
    queryFn: loadAccess,
    enabled: Boolean(session),
    placeholderData: (previous, previousQuery) => keepSameUser(previous, previousQuery?.queryKey, queryKey),
  })

  if (!ready) return { phase: 'loading' }
  if (!session) return { phase: 'ready', decision: 'login', status: null }
  if (query.data) {
    const { aal, status } = query.data
    const decision = decideStudioAccess(session, aal, status)
    if (decision === 'ok' && status.state === 'ok') return { phase: 'ready', decision, status, session }
    return { phase: 'ready', decision: decision === 'ok' ? 'ended' : decision, status }
  }
  if (query.isError) return { phase: 'error', error: query.error, retry: () => void query.refetch() }
  return { phase: 'loading' }
}

/**
 * Sign out THIS browser only. Never { scope: 'global' }: a committee shares
 * one account, and a global sign-out would end everyone's session.
 * Returns the error when the server could not be reached (the local session
 * then stays until the tab is closed, because sessionStorage is per tab).
 */
export async function signOutStudio(queryClient?: QueryClient): Promise<{ error: unknown }> {
  const { error } = await studioDb.auth.signOut({ scope: 'local' })
  queryClient?.removeQueries({ queryKey: STUDIO_QUERY_KEY })
  return { error: error ?? null }
}
