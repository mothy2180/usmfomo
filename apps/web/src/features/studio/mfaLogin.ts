// /login/mfa: what to show, and the device last used in this browser.
import type { TotpFactor } from './factors.ts'

export type MfaLoginData = { currentLevel: string | null; factors: TotpFactor[] }
export type MfaStep = 'wait' | 'login' | 'studio' | 'code'

/**
 *   wait   — session or factors still loading
 *   login  — no session: sign in first
 *   studio — nothing to verify (already aal2, or no device any more); the
 *            studio guard decides from there
 *   code   — ask for a code
 */
export function mfaStep(ready: boolean, hasSession: boolean, data: MfaLoginData | undefined): MfaStep {
  if (!ready) return 'wait'
  if (!hasSession) return 'login'
  if (!data) return 'wait'
  if (data.currentLevel === 'aal2' || data.factors.length === 0) return 'studio'
  return 'code'
}

// Per-browser convenience only: preselect the device last used here. A
// factor id is not a secret, and ids of another account never match.
const LAST_FACTOR_KEY = 'usmfomo.studio.lastFactor'

export function readLastFactor(): string | null {
  try {
    return window.localStorage.getItem(LAST_FACTOR_KEY)
  } catch {
    return null
  }
}

export function saveLastFactor(id: string): void {
  try {
    window.localStorage.setItem(LAST_FACTOR_KEY, id)
  } catch {
    // storage blocked: nothing is preselected next time
  }
}
