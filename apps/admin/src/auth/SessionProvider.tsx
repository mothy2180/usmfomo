import { useQueryClient } from '@tanstack/react-query'
import { usernameToEmail } from '@usmfomo/shared/supabase'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AdminApiError } from '../lib/api.ts'
import { adminApi, ownerDb } from '../lib/db.ts'
import { verifiedTotpFactors } from '../lib/mfa.ts'
import { qk } from '../lib/queries.ts'
import { NOTICES, SessionContext, type Phase, type Session } from '../lib/sessionContext.ts'
import { onSessionProblem, sessionProblem, type SessionProblem } from '../lib/sessionEvents.ts'

/** my_posting_status() states that belong to club/school accounts. */
const OTHER_ACCOUNT_STATES = new Set(['ok', 'mfa_required', 'inactive', 'session_ended', 'no_account'])

/**
 * Pre-check at aal1, before any TOTP step: my_posting_status() reports
 * "owner" for the owner account (it checks is_owner before MFA). This keeps a
 * club account that wanders in here from being pushed to enrol a TOTP device
 * (which would make 2FA mandatory for that club). The binding owner check is
 * still owner-admin "status" at aal2.
 */
async function accountKind(): Promise<'owner' | 'other' | 'unknown'> {
  const { data, error } = await ownerDb.rpc('my_posting_status')
  if (error) return 'unknown'
  const state = data && typeof data === 'object' && !Array.isArray(data) ? (data as { state?: unknown }).state : undefined
  if (state === 'owner') return 'owner'
  if (typeof state === 'string' && OTHER_ACCOUNT_STATES.has(state)) return 'other'
  return 'unknown'
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [phase, setPhaseState] = useState<Phase>({ kind: 'signed_out', notice: null })
  const [username, setUsername] = useState<string | null>(null)
  const phaseRef = useRef<Phase>(phase)
  const ownerHint = useRef(false)
  const skippedSecond = useRef(false)
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

    async function afterOwnerConfirmed(): Promise<void> {
      let devices = 2
      try {
        const factors = await verifiedTotpFactors()
        queryClient.setQueryData(qk.factors, factors)
        devices = factors.length
      } catch {
        // Not critical: Overview lists the devices as well.
      }
      setPhase(devices < 2 && !skippedSecond.current ? { kind: 'second_device' } : { kind: 'ready' })
    }

    async function currentAal(): Promise<string | null> {
      const { data, error } = await ownerDb.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error) throw error
      return data.currentLevel
    }

    /** aal2 → owner check; a verified device → code; none → forced enrolment. */
    async function routeByAal(): Promise<void> {
      if ((await currentAal()) === 'aal2') return checkStatus()
      const factors = await verifiedTotpFactors()
      setPhase(factors.length ? { kind: 'challenge', factors } : { kind: 'enrol' })
    }

    async function checkStatus(): Promise<void> {
      setPhase({ kind: 'checking' })
      try {
        queryClient.setQueryData(qk.status, await adminApi.status())
      } catch (err) {
        if (err instanceof AdminApiError) {
          if (err.code === 'forbidden') return endSession('local', { kind: 'not_owner' })
          if (err.code === 'unauthorized') return endSession('local', { kind: 'signed_out', notice: NOTICES.ended })
          if (err.code === 'mfa_required' && (await currentAal().catch(() => null)) !== 'aal2') return routeByAal()
        }
        setPhase({ kind: 'status_error', error: err, ownerHint: ownerHint.current })
        return
      }
      await afterOwnerConfirmed()
    }

    async function signIn(name: string, password: string, captchaToken: string): Promise<void> {
      const { error } = await ownerDb.auth.signInWithPassword({
        email: usernameToEmail(name),
        password,
        options: { captchaToken },
      })
      if (error) throw error
      skippedSecond.current = false
      setUsername(name.trim().toLowerCase())
      try {
        const kind = await accountKind()
        // Not the owner: end only this session, so a club's other members stay signed in.
        if (kind === 'other') return endSession('local', { kind: 'not_owner' })
        ownerHint.current = kind === 'owner'
        await routeByAal()
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
        else if (sessionProblem(err) === 'mfa') await routeByAal().catch(() => undefined)
        // Anything else (function down): keep going; RLS still guards every write.
      } finally {
        rechecking.current = false
      }
    }

    async function handleProblem(problem: SessionProblem): Promise<void> {
      const kind = phaseRef.current.kind
      if (kind === 'signed_out' || kind === 'not_owner' || kind === 'checking') return
      if (problem === 'ended') return endSession('local', { kind: 'signed_out', notice: NOTICES.ended })
      if (problem === 'mfa') {
        return routeByAal().catch(() => endSession('local', { kind: 'signed_out', notice: NOTICES.ended }))
      }
      return recheckOwner()
    }

    return {
      signIn,
      handleProblem,
      mfaVerified: () => checkStatus(),
      retryStatus: () => checkStatus(),
      continueLimited: () => setPhase({ kind: 'ready' }),
      continueToConsole: () => {
        skippedSecond.current = true
        setPhase({ kind: 'ready' })
      },
      signOut: (notice: string | null = NOTICES.signedOut) => endSession('global', { kind: 'signed_out', notice }),
      backToSignIn: () => setPhase({ kind: 'signed_out', notice: null }),
    }
  }, [queryClient, setPhase])

  // A session can also end outside the console (refresh token revoked by a
  // password reset or a global sign-out elsewhere).
  useEffect(() => {
    const { data } = ownerDb.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return
      sawSignedOut.current = true
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
      mfaVerified: actions.mfaVerified,
      retryStatus: actions.retryStatus,
      continueLimited: actions.continueLimited,
      continueToConsole: actions.continueToConsole,
      signOut: actions.signOut,
      backToSignIn: actions.backToSignIn,
    }),
    [phase, username, actions],
  )

  return <SessionContext value={value}>{children}</SessionContext>
}
