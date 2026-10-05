// Any failed request can reveal that the owner session is over. Queries,
// mutations and direct calls report errors here; the session provider listens
// and signs out, re-asks for a code, or re-checks owner access.
import { AdminApiError } from './api.ts'
import { NoRowsError } from './messages.ts'

/** ended: sign in again · mfa: needs an aal2 code · check: ask owner-admin whether the session is still the owner's */
export type SessionProblem = 'ended' | 'mfa' | 'check'

const ENDED_CODES = new Set([
  'PGRST301', // JWT invalid
  'PGRST302', // bearer missing
  'PGRST303', // JWT expired / claims invalid
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
])

export function sessionProblem(err: unknown): SessionProblem | null {
  if (err instanceof AdminApiError) {
    if (err.code === 'unauthorized') return 'ended'
    if (err.code === 'mfa_required') return 'mfa'
    // The caller may no longer be the owner (deactivated with the CLI), or the
    // action was refused for the owner's own row: a status re-check tells which.
    if (err.code === 'forbidden') return 'check'
    return null
  }
  // RLS refused an owner write, or an update matched nothing: is_owner() may
  // be false because the session ended elsewhere (e.g. a global sign-out).
  if (err instanceof NoRowsError) return 'check'
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  if (typeof code !== 'string') return null
  if (ENDED_CODES.has(code)) return 'ended'
  if (code === 'insufficient_aal') return 'mfa'
  if (code === '42501') return 'check'
  return null
}

type Listener = (problem: SessionProblem) => void
const listeners = new Set<Listener>()

export function onSessionProblem(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function reportSessionProblem(err: unknown): void {
  const problem = sessionProblem(err)
  if (problem) for (const l of listeners) l(problem)
}
