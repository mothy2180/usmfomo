// owner-admin authorisation chain (docs/api.md), after the CORS check:
//   bearer token → getClaims (signature + expiry) → role authenticated + aal2
//   → getUser (live session, not banned) → admin_is_owner.
// Any failure stops the request.
import { HttpError } from '../_shared/http.ts'
import { uuid } from '../_shared/validate.ts'
import type { OwnerAdminPort } from './types.ts'

const BEARER_JWT = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i

/** The access token from `Authorization: Bearer <jwt>`; API keys (sb_…) are not tokens. */
export function bearerToken(header: string | null): string | null {
  const match = BEARER_JWT.exec((header ?? '').trim())
  return match ? match[1] : null
}

export type Caller = { userId: string }

export async function authorise(
  req: Request,
  port: Pick<OwnerAdminPort, 'verifyToken' | 'sessionUserId' | 'isOwner'>,
): Promise<Caller> {
  const token = bearerToken(req.headers.get('Authorization'))
  if (!token) throw new HttpError('unauthorized')

  const claims = await port.verifyToken(token)
  const sub = uuid(claims.sub)
  if (claims.role !== 'authenticated' || !sub) throw new HttpError('unauthorized')
  if (claims.aal !== 'aal2') throw new HttpError('mfa_required')

  const userId = await port.sessionUserId(token)
  if (userId !== sub) throw new HttpError('unauthorized')

  if (!(await port.isOwner(userId))) throw new HttpError('forbidden')
  return { userId }
}
