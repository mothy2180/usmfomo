import { describe, expect, it } from 'vitest'
import { PosterError } from '../../lib/poster.ts'
import { studioErrorKey } from './errorMessage.ts'
import { UnconfirmedCreate } from './submitPost.ts'
import type { PostInsertRow } from './types.ts'

const storageError = (statusCode: string, extra: Record<string, unknown> = {}) => ({
  name: 'StorageApiError',
  message: 'x',
  status: 400,
  statusCode,
  ...extra,
})

describe('studioErrorKey', () => {
  it('passes poster pipeline errors through', () => {
    expect(studioErrorKey(new PosterError('file_type'))).toBe('errors:file_type')
    expect(studioErrorKey(new PosterError('image_too_big_after'))).toBe('errors:image_too_big_after')
  })

  it('explains Storage refusals', () => {
    expect(studioErrorKey(storageError('413'))).toBe('errors:image_too_big_after')
    expect(studioErrorKey(storageError('415'))).toBe('errors:file_type')
    expect(studioErrorKey(storageError('400', { code: 'InvalidMimeType' }))).toBe('errors:file_type')
    // RLS on storage.objects: paused, 40 files, bucket full or session over.
    expect(studioErrorKey(storageError('403'))).toBe('studio:poster.refused')
    expect(studioErrorKey({ name: 'StorageApiError', message: 'x', status: 403 })).toBe('studio:poster.refused')
  })

  it('names 2FA device problems', () => {
    expect(studioErrorKey({ name: 'AuthApiError', code: 'mfa_factor_name_conflict', status: 422 })).toBe('studio:settings.nameTaken')
    expect(studioErrorKey({ name: 'AuthApiError', code: 'too_many_enrolled_mfa_factors', status: 422 })).toBe('studio:settings.tooMany')
    expect(studioErrorKey({ name: 'AuthApiError', code: 'mfa_verification_failed', status: 422 })).toBe('errors:auth_bad_code')
    expect(studioErrorKey({ name: 'AuthApiError', code: 'insufficient_aal', status: 403 })).toBe('errors:mfa_required')
  })

  it('says a new post may be live when its answer was lost, unless the check itself was refused', () => {
    const row = { title: 'Hack Night' } as PostInsertRow
    expect(studioErrorKey(new UnconfirmedCreate(row, { code: '', message: 'TypeError: Failed to fetch', status: 0 }))).toBe('studio:form.unconfirmed')
    expect(studioErrorKey(new UnconfirmedCreate(row, new TypeError('Failed to fetch')))).toBe('studio:form.unconfirmed')
    // Looking for it on the retry: the session had ended meanwhile.
    expect(studioErrorKey(new UnconfirmedCreate(row, { code: 'PGRST301', message: 'JWT expired', status: 401 }))).toBe('errors:session_ended')
  })

  it('falls back to the shared database/Auth mapping', () => {
    expect(studioErrorKey({ code: 'P0001', message: 'quota_daily' })).toBe('errors:quota_daily')
    expect(studioErrorKey({ code: 'P0001', message: 'posting_paused' })).toBe('errors:posting_paused')
    expect(studioErrorKey({ code: '42501', message: 'no rows matched' })).toBe('errors:not_allowed')
    expect(studioErrorKey(new TypeError('Failed to fetch'))).toBe('errors:network')
    expect(studioErrorKey(null)).toBe('errors:unknown')
  })
})
