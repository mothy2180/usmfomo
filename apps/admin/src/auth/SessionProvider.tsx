import { useQueryClient } from '@tanstack/react-query'
import { usernameToEmail } from '@usmfomo/shared/supabase'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AdminApiError } from '../lib/api.ts'
import { adminApi, ownerDb } from '../lib/db.ts'
import { AccountCheckError } from '../lib/messages.ts'
import { qk } from '../lib/queries.ts'
import { NOTICES, SessionContext, type Phase, type Session } from '../lib/sessionContext.ts'
import { onSessionProblem, sessionProblem, type SessionProblem } from '../lib/sessionEvents.ts'

/** my_posting_status() states that belong to club/school accounts. */
const OTHER_ACCOUNT_STATES = new Set(['ok', 'inactive', 'session_ended', 'no_account'])

type AccountKind = 'owner' | 'other' | 'unknown'

function kindOf(data: unknown): AccountKind {
  const state = data && typeof data === 'object' && !Array.isArray(data) ? (data as { state?: unknown }).state : undefined
  if (state === 'owner') return 'owner'
  if (typeof state === 'string' && OTHER_ACCOUNT_STATES.has(state)) return 'other'
  return 'unknown'
}

/**
 * Pre-check right after the password: my_posting_status() reports "owner" for
 * the owner account. A club account that wanders in here is signed out locally
 * at once (even when owner-admin is down), and only an apparent owner is ever
 * offered limited mode. A failed call is tried once more; "unknown" then fails
 * the sign-in. The binding owner check is still owner-admin "status".
 */
async function accountKind(): Promise<AccountKind> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await ownerDb.rpc('my_posting_status')
    if (!error) return kindOf(data)
  }
  return 'unknown'
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [phase, setPhaseState] = useState<Phase>({ kind: 'signed_out', notice: null })
  const [username, setUsername] = useState<string | null>(null)
  const phaseRef = useRef<Phase>(phase)
  const ownerHint = useRef(false)
  // owner-admin confirmed the owner in this session: only then is sign-out global.
  const ownerConfirmed = useRef(false)
  const sawSignedOut = useRef(false)
  const rechecking = useRef(false)

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])

  const actions = useMemo(() => {
    /** Moves the UI first (so nothing else uses the session), then signs out. */
    async function endSession(scope: 'global' | 'local', next: Phase): Promise<void> {
      setPhase(next)
      setUsername(null)
      ownerHint.current = false
      ownerConfirmed.current = false
      sawSignedOut.current = false
      let failed = false
      try {
        const { error } = await ownerDb.auth.signOut({ scope })
        failed = Boolean(error)
      } catch {
        failed = true
      }
      queryClient.clear()
      if (!sawSignedOut.current) {
        // supabase-js kept the session (it could not even refresh it to sign
        // out). A reload is the only sure way to drop a memory-only session.
        window.location.reload()
        return
      }
      if (failed && scope === 'global' && next.kind === 'signed_out') {
        setPhase({ kind: 'signed_out', notice: NOTICES.offline })
      }
    }

    async function checkStatus(): Promise<void> {
      setPhase({ kind: 'checking' })
      try {
        queryClient.setQueryData(qk.status, await adminApi.status())
      } catch (err) {
        if (err instanceof AdminApiError) {
          if (err.code === 'forbidden') return endSession('local', { kind: 'not_owner' })
          if (err.code === 'unauthorized') return endSession('local', { kind: 'signed_out', notice: NOTICES.ended })
        }
        setPhase({ kind: 'status_error', error: err, ownerHint: ownerHint.current })
        return
      }
      ownerConfirmed.current = true
      setPhase({ kind: 'ready' })
    }

    async function signIn(name: string, password: string, captchaToken: string): Promise<void> {
      const { error } = await ownerDb.auth.signInWithPassword({
        email: usernameToEmail(name),
        password,
        options: { captchaToken },
      })
      if (error) throw error
      setUsername(name.trim().toLowerCase())
      try {
        const kind = await accountKind()
        // Not the owner: end only this session, so a club's other members stay signed in.
        if (kind === 'other') return endSession('local', { kind: 'not_owner' })
        // Couldn't tell: a failed sign-in (signed out locally below), so a club
        // never reaches the owner check or limited mode.
        if (kind === 'unknown') throw new AccountCheckError()
        ownerHint.current = true
        await checkStatus()
      } catch (err) {
        await endSession('local', { kind: 'signed_out', notice: null })
        throw err
      }
    }

    async function recheckOwner(): Promise<void> {
      if (rechecking.current) return
      rechecking.current = true
      try {
        await adminApi.status()
      } catch (err) {
        if (err instanceof AdminApiError && err.code === 'forbidden') await endSession('local', { kind: 'not_owner' })
        else if (sessionProblem(err) === 'ended') await endSession('local', { kind: 'signed_out', notice: NOTICES.ended })
        // Anything else (function down): keep going; RLS still guards every write.
      } finally {
        rechecking.current = false
      }
    }

    async function handleProblem(problem: SessionProblem): Promise<void> {
      const kind = phaseRef.current.kind
      if (kind === 'signed_out' || kind === 'not_owner' || kind === 'checking') return
      if (problem === 'ended') return endSession('local', { kind: 'signed_out', notice: NOTICES.ended })
      return recheckOwner()
    }

    return {
      signIn,
      handleProblem,
      retryStatus: () => checkStatus(),
      continueLimited: () => setPhase({ kind: 'ready' }),
      // Global only for a confirmed owner: before that (status check, status
      // error, limited mode) this may not be the owner, and a club's global
      // sign-out would end every committee member's session.
      signOut: (notice: string | null = NOTICES.signedOut) =>
        endSession(ownerConfirmed.current ? 'global' : 'local', { kind: 'signed_out', notice }),
      backToSignIn: () => setPhase({ kind: 'signed_out', notice: null }),
    }
  }, [queryClient, setPhase])

  // A session can also end outside the console (refresh token revoked by a
  // password reset or a global sign-out elsewhere).
  useEffect(() => {
    const { data } = ownerDb.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return
      sawSignedOut.current = true
      ownerHint.current = false
      ownerConfirmed.current = false
      const kind = phaseRef.current.kind
      if (kind === 'signed_out' || kind === 'not_owner') return
      setPhase({ kind: 'signed_out', notice: NOTICES.ended })
      setUsername(null)
      queryClient.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient, setPhase])

  useEffect(() => onSessionProblem((problem) => void actions.handleProblem(problem)), [actions])

  const value = useMemo<Session>(
    () => ({
      phase,
      username,
      signIn: actions.signIn,
      retryStatus: actions.retryStatus,
      continueLimited: actions.continueLimited,
      signOut: actions.signOut,
      backToSignIn: actions.backToSignIn,
    }),
    [phase, username, actions],
  )

  return <SessionContext value={value}>{children}</SessionContext>
}
