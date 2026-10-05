// 2FA (TOTP) calls for the club studio, as the signed-in account. Supabase
// Auth enforces the rules; these wrappers only throw its errors:
//   - adding a device once one exists, or removing a verified device, needs an
//     aal2 session (error code insufficient_aal);
//   - a successful verify upgrades this session to aal2 and signs out the
//     account's other sessions that are still at aal1;
//   - removing a device downgrades the sessions that used it to aal1.
import { studioDb } from '../../lib/db.ts'
import { otpauthHref, pendingTotp, qrImageSrc, verifiedTotp, type TotpFactor } from './factors.ts'
import type { MfaLoginData } from './mfaLogin.ts'

export const TOTP_ISSUER = 'usmfomo'

export type Devices = { verified: TotpFactor[]; pending: TotpFactor[] }

export type Enrollment = {
  factorId: string
  name: string
  /** <img src> for the QR code, or null if it could not be shown. */
  qrSrc: string | null
  secret: string
  /** otpauth://totp/… for "Open in authenticator app", or null. */
  uri: string | null
}

/** Verified devices (oldest first) and unconfirmed setups. listFactors()
 * fetches the user again, so this sees devices other members added. */
export async function listDevices(): Promise<Devices> {
  const { data, error } = await studioDb.auth.mfa.listFactors()
  if (error) throw error
  return { verified: verifiedTotp(data.all), pending: pendingTotp(data.all) }
}

/** For /login/mfa: this session's level (from the cached session) and the
 * verified devices (fresh from Auth). */
export async function loadMfaLogin(): Promise<MfaLoginData> {
  const [aal, devices] = await Promise.all([studioDb.auth.mfa.getAuthenticatorAssuranceLevel(), listDevices()])
  if (aal.error) throw aal.error
  return { currentLevel: aal.data.currentLevel, factors: devices.verified }
}

const enroll = (name: string) => studioDb.auth.mfa.enroll({ factorType: 'totp', friendlyName: name, issuer: TOTP_ISSUER })

/** Starts adding a device named after its owner. */
export async function startEnrollment(name: string): Promise<Enrollment> {
  let res = await enroll(name)
  if (res.error?.code === 'mfa_factor_name_conflict') {
    // A setup abandoned a moment ago (tab closed before the code was entered)
    // still holds the name. An unconfirmed factor can be removed at aal1.
    const stale = (await listDevices()).pending.find((f) => f.friendly_name === name)
    if (stale) {
      const { error } = await studioDb.auth.mfa.unenroll({ factorId: stale.id })
      if (!error) res = await enroll(name)
    }
  }
  if (res.error) throw res.error
  const { id, totp } = res.data
  return { factorId: id, name, qrSrc: qrImageSrc(totp.qr_code), secret: totp.secret, uri: otpauthHref(totp.uri) }
}

/** Checks a 6-digit code: signs in with a device (aal2) or confirms a new one. */
export async function verifyCode(factorId: string, code: string): Promise<void> {
  const { error } = await studioDb.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) throw error
}

/** Abandons an unconfirmed setup (best effort: Auth also expires them). */
export async function cancelEnrollment(factorId: string): Promise<void> {
  try {
    await studioDb.auth.mfa.unenroll({ factorId })
  } catch {
    // network: the unconfirmed factor expires on its own
  }
}

/** Removes a verified device (needs aal2). */
export async function removeDevice(factorId: string): Promise<void> {
  const { error } = await studioDb.auth.mfa.unenroll({ factorId })
  if (error) throw error
  // If this session signed in with that device it is now aal1 on the server,
  // but supabase-js still holds the old token: refresh so the studio sees the
  // real level (and asks for another device's code). A failed refresh is
  // harmless — the token refreshes on its own soon.
  await studioDb.auth.refreshSession().catch(() => undefined)
}
