import { describe, expect, it } from 'vitest'
import { AdminApiError } from './api.ts'
import { errorMessage, NoRowsError } from './messages.ts'

describe('errorMessage', () => {
  it('explains owner-admin codes, with action-specific wording where it matters', () => {
    expect(errorMessage(new AdminApiError('create_account', 'conflict', 409))).toBe(
      'That username, organisation name or slug is already taken.',
    )
    expect(errorMessage(new AdminApiError('update_org', 'conflict', 409))).toBe('Another organisation already uses that name or slug.')
    expect(errorMessage(new AdminApiError('status', 'conflict', 409))).toBe('That conflicts with existing data.')
    expect(errorMessage(new AdminApiError('status', 'unavailable', 404))).toMatch(/unavailable/)
    // A dropped connection may or may not have run the action.
    expect(errorMessage(new AdminApiError('handover', 'network'))).toMatch(/may or may not have happened/)
  })

  it('appends a short unknown server code so the owner can report it', () => {
    expect(errorMessage(new AdminApiError('status', 'bad_request', 400, 'not_implemented'))).toMatch(/\(not_implemented\)$/)
  })

  it('maps database and Auth errors through errorKey()', () => {
    expect(errorMessage({ code: '23514', message: 'new row violates check constraint "notices_link_url"' })).toMatch(/https:\/\//)
    expect(errorMessage({ code: '42501', message: 'permission denied' })).toMatch(/session may have ended/)
    expect(errorMessage({ code: 'invalid_credentials', status: 400 })).toBe('Wrong username or password.')
    expect(errorMessage({ code: 'captcha_failed', status: 400 })).toMatch(/security check/)
    expect(errorMessage({ code: 'mfa_verification_failed', status: 422 })).toMatch(/code didn't work/)
    expect(errorMessage({ code: 'mfa_factor_name_conflict', status: 422 })).toMatch(/already have a device with that name/)
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/Couldn't reach the server/)
    expect(errorMessage(new NoRowsError())).toMatch(/Nothing changed/)
    expect(errorMessage(undefined)).toBe('Something went wrong. Try again.')
  })
})
