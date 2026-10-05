import { ownerDb } from './db.ts'

export type OwnerFactor = { id: string; name: string; createdAt: string }

/** Verified TOTP factors of the signed-in user, oldest first (fresh from Auth). */
export async function verifiedTotpFactors(): Promise<OwnerFactor[]> {
  const { data, error } = await ownerDb.auth.mfa.listFactors()
  if (error) throw error
  return data.totp
    .map((f) => ({ id: f.id, name: f.friendly_name?.trim() || 'Authenticator app', createdAt: f.created_at }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** An abandoned enrolment leaves an unverified factor whose name blocks a new
 * one; remove those before enrolling (allowed at aal1 when nothing is verified). */
export async function removeUnverifiedTotp(): Promise<void> {
  const { data, error } = await ownerDb.auth.mfa.listFactors()
  if (error) throw error
  for (const f of data.all) {
    if (f.factor_type === 'totp' && f.status === 'unverified') {
      await ownerDb.auth.mfa.unenroll({ factorId: f.id })
    }
  }
}
