// Club studio session: who is signed in, whether they may use the studio,
// and signing out. The database decides (my_posting_status, RLS); this only
// routes the UI. Sessions live in sessionStorage (see db.ts), and a session
// whose tab has gone 30 minutes without input is never used (see idle.ts).
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { CAMPUSES, LIMITS, ORG_TYPES, type Campus, type OrgType } from '@usmfomo/shared/config'
import { errorKey } from '@usmfomo/shared/errors'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { studioDb } from './db.ts'
import { idleExpired, readLastActivity } from './idle.ts'

/** Every studio query key starts with this, so sign-out can drop them all. */
export const STUDIO_QUERY_KEY = ['studio'] as const

// ---------------------------------------------------------------------------
// my_posting_status()
// ---------------------------------------------------------------------------

export const POSTING_STATES = ['ok', 'inactive', 'session_ended', 'no_account', 'owner', 'anonymous'] as const
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
  }
}

// ---------------------------------------------------------------------------
// The decision (pure)
// ---------------------------------------------------------------------------

export type StudioDecision = 'ok' | 'login' | 'inactive' | 'owner' | 'ended'

/**
 * Where a studio page should go:
 *   login    — no session (or the database sees no signed-in user)
 *   owner    — the owner account: it uses the owner console, never the studio
 *   inactive — paused account/org, or the account no longer exists
 *   ended    — the session was revoked (password reset / handover)
 *   ok       — may use the studio
 */
export function decideStudioAccess(session: object | null, status: { state: PostingState } | null): StudioDecision {
  if (!session) return 'login'
  switch (status?.state) {
    case 'ok':
      return 'ok'
    case 'owner':
      return 'owner'
    case 'inactive':
    case 'no_account':
      return 'inactive'
    case 'anonymous':
      return 'login'
    default:
      // 'session_ended', or no answer: never 'ok'.
      return 'ended'
  }
}

/** The session id claim we key caches on. Reading our own token is not a
 * security check: the database verifies every request. */
export function tokenSessionId(accessToken: string): string | null {
  try {
    const part = accessToken.split('.')[1] ?? ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return isRecord(payload) ? str(payload.session_id) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

type SessionState = { ready: boolean; session: Session | null }

// "You were signed out after 30 minutes without activity" on /login. Set by
// whichever page signed the tab out; cleared when a new sign-in starts.
let idleNotice = false
const noticeListeners = new Set<() => void>()

function setIdleNotice(next: boolean): void {
  idleNotice = next
  for (const listener of noticeListeners) listener()
}

function subscribeIdleNotice(listener: () => void): () => void {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}

export const noteIdleSignOut = (): void => setIdleNotice(true)
export const clearIdleSignOut = (): void => setIdleNotice(false)
export const useIdleSignOutNotice = (): boolean => useSyncExternalStore(subscribeIdleNotice, () => idleNotice)

/** This tab has gone without input for the idle limit (see idle.ts). */
const idleTooLong = (): boolean => idleExpired(readLastActivity())

/**
 * This tab's own session, or null. One whose tab has gone without input for
 * the idle limit is signed out here (local scope), before anything uses it:
 * closing a tab doesn't end its session, and reopening the tab or restoring
 * the browser session brings it back.
 */
async function loadOwnSession(queryClient: QueryClient): Promise<Session | null> {
  const { data } = await studioDb.auth.getSession()
  if (!data.session || !idleTooLong()) return data.session
  noteIdleSignOut()
  await signOutStudio(queryClient)
  return null
}

/** The studio session from sessionStorage, kept current via onAuthStateChange. */
export function useStudioSession(): SessionState {
  const queryClient = useQueryClient()
  const [state, setState] = useState<SessionState>({ ready: false, session: null })

  useEffect(() => {
    let active = true
    const settle = () =>
      void loadOwnSession(queryClient).then((session) => {
        if (active) setState({ ready: true, session })
      })
    settle()
    // Only set state here: calling other auth methods inside this callback
    // can deadlock supabase-js.
    const { data } = studioDb.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (session && idleTooLong()) {
        // E.g. the token refreshed once a restored tab got back online. Never
        // use it: check (and end) this tab's own copy outside this callback.
        setState({ ready: false, session: null })
        window.setTimeout(settle, 0)
      } else {
        setState({ ready: true, session })
      }
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

async function loadAccess(): Promise<PostingStatus> {
  const { data, error } = await studioDb.rpc('my_posting_status')
  if (error) {
    // An expired or revoked JWT: treat like a revoked session.
    if (errorKey(error) === 'session_ended') return { state: 'session_ended', username: null }
    throw error
  }
  return parsePostingStatus(data)
}

/** Query key for the access check: a new user or session refetches. */
export function accessKey(session: Session | null) {
  return [...STUDIO_QUERY_KEY, 'access', session?.user.id ?? '', session ? (tokenSessionId(session.access_token) ?? '') : ''] as const
}

/** Session + my_posting_status() -> a decision for studio pages. */
export function useStudioAccess(): StudioAccess {
  const { ready, session } = useStudioSession()
  const query = useQuery({
    queryKey: accessKey(session),
    queryFn: loadAccess,
    enabled: Boolean(session),
  })

  if (!ready) return { phase: 'loading' }
  if (!session) return { phase: 'ready', decision: 'login', status: null }
  if (query.data) {
    const status = query.data
    const decision = decideStudioAccess(session, status)
    if (decision === 'ok' && status.state === 'ok') return { phase: 'ready', decision, status, session }
    return { phase: 'ready', decision: decision === 'ok' ? 'ended' : decision, status }
  }
  if (query.isError) return { phase: 'error', error: query.error, retry: () => void query.refetch() }
  return { phase: 'loading' }
}

/**
 * Sign out THIS browser only. Never { scope: 'global' }: a committee shares
 * one account, and a global sign-out would end everyone's session.
 * Returns the error when usmfomo could not be reached. supabase-js still drops
 * this tab's copy then, unless the access token had expired as well (it must
 * refresh before it can sign out): that copy stays until a sign-out gets
 * through. Closing the tab does not end it; the idle check above does, once
 * the tab has gone 30 minutes without input.
 */
export async function signOutStudio(queryClient?: QueryClient): Promise<{ error: unknown }> {
  const { error } = await studioDb.auth.signOut({ scope: 'local' })
  queryClient?.removeQueries({ queryKey: STUDIO_QUERY_KEY })
  return { error: error ?? null }
}
