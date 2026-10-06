// One place that turns any studio failure into an i18n key (with namespace).
// Database/Auth errors go through errorKey() from the shared package; Storage
// and a few Auth MFA codes it does not know are mapped here.
import { errorKey } from '@usmfomo/shared/errors'
import { PosterError } from '../../lib/poster.ts'
import { isRefusal, UnconfirmedCreate } from './submitPost.ts'

type Loose = { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown }

/** StorageApiError: `statusCode` is the service's own code (often the real
 * HTTP status as a string, even when the response itself was a 400). */
function storageKey(e: Loose): string | null {
  if (typeof e.name !== 'string' || !e.name.startsWith('Storage')) return null
  const code = typeof e.code === 'string' ? e.code : ''
  const status = String(e.statusCode ?? e.status ?? '')
  if (code === 'EntityTooLarge' || status === '413') return 'errors:image_too_big_after'
  if (code === 'InvalidMimeType' || status === '415') return 'errors:file_type'
  // RLS on storage.objects: posting paused, 40 files in the folder, bucket
  // nearly full, or this session may no longer write.
  if (code === 'AccessDenied' || status === '403' || status === '401') return 'studio:poster.refused'
  return null
}

const MFA_KEYS: Record<string, string> = {
  mfa_factor_name_conflict: 'studio:settings.nameTaken',
  too_many_enrolled_mfa_factors: 'studio:settings.tooMany',
}

export function studioErrorKey(err: unknown): string {
  if (err instanceof PosterError) return `errors:${err.key}`
  // A new post's answer was lost. A refusal while looking for it (the session
  // ended, say) says more than "couldn't confirm".
  if (err instanceof UnconfirmedCreate) return isRefusal(err.cause) ? studioErrorKey(err.cause) : 'studio:form.unconfirmed'
  if (typeof err === 'object' && err !== null) {
    const e = err as Loose
    const storage = storageKey(e)
    if (storage) return storage
    if (typeof e.code === 'string' && MFA_KEYS[e.code]) return MFA_KEYS[e.code]!
  }
  return `errors:${errorKey(err)}`
}
