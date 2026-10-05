import { createContext, useContext } from 'react'
import type { OwnerFactor } from './mfa.ts'

/**
 * Where the owner is in the sign-in flow:
 *   signed_out → (password + Turnstile) → enrol | challenge → checking
 *   → second_device (only one TOTP device) → ready
 * not_owner and status_error are dead ends with a way back.
 */
export type Phase =
  | { kind: 'signed_out'; notice: string | null }
  | { kind: 'not_owner' }
  | { kind: 'enrol' }
  | { kind: 'challenge'; factors: OwnerFactor[] }
  | { kind: 'checking' }
  | { kind: 'status_error'; error: unknown; ownerHint: boolean }
  | { kind: 'second_device' }
  | { kind: 'ready' }

export type Session = {
  phase: Phase
  username: string | null
  /** Throws the Auth error so the form can show it. */
  signIn: (username: string, password: string, captchaToken: string) => Promise<void>
  /** After a TOTP code was verified (enrolment or challenge): the session is aal2. */
  mfaVerified: () => Promise<void>
  retryStatus: () => Promise<void>
  /** Enter the console although owner-admin is unreachable (PostgREST features only). */
  continueLimited: () => void
  /** Leave the second-device prompt (with one or two devices). */
  continueToConsole: () => void
  /** Global sign-out (every session of the owner), then back to the sign-in form. */
  signOut: (notice?: string | null) => Promise<void>
  /** From the "not the owner" screen back to the sign-in form. */
  backToSignIn: () => void
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession outside SessionProvider')
  return session
}

export function hasSession(phase: Phase): boolean {
  return phase.kind !== 'signed_out' && phase.kind !== 'not_owner'
}

export const NOTICES = {
  idle: 'You were signed out after 30 minutes without activity.',
  ended: 'Your session has ended. Sign in again.',
  signedOut: 'You are signed out.',
  offline:
    "You are signed out in this browser, but the server couldn't be reached to end your other sessions. They expire on their own; sign in and out again to end them now.",
} as const
