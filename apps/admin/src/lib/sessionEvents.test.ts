import { describe, expect, it, vi } from 'vitest'
import { AdminApiError } from './api.ts'
import { NoRowsError } from './messages.ts'
import { shouldRetry } from './queryClient.ts'
import { onSessionProblem, reportSessionProblem, sessionProblem } from './sessionEvents.ts'

describe('sessionProblem', () => {
  it('maps owner-admin codes', () => {
    expect(sessionProblem(new AdminApiError('status', 'unauthorized', 401))).toBe('ended')
    expect(sessionProblem(new AdminApiError('status', 'mfa_required', 403))).toBe('mfa')
    expect(sessionProblem(new AdminApiError('reset_password', 'forbidden', 403))).toBe('check')
    expect(sessionProblem(new AdminApiError('status', 'internal', 500))).toBeNull()
    expect(sessionProblem(new AdminApiError('status', 'network'))).toBeNull()
  })

  it('maps PostgREST and Auth errors', () => {
    expect(sessionProblem({ code: 'PGRST303', message: 'JWT expired' })).toBe('ended')
    expect(sessionProblem({ code: 'session_not_found' })).toBe('ended')
    expect(sessionProblem({ code: 'insufficient_aal' })).toBe('mfa')
    // RLS refused an owner write: is the session still the owner's?
    expect(sessionProblem({ code: '42501' })).toBe('check')
    expect(sessionProblem(new NoRowsError())).toBe('check')
    expect(sessionProblem({ code: '23505' })).toBeNull()
    expect(sessionProblem(null)).toBeNull()
    expect(sessionProblem('boom')).toBeNull()
  })

  it('notifies listeners only for session problems, until unsubscribed', () => {
    const listener = vi.fn()
    const off = onSessionProblem(listener)
    reportSessionProblem(new AdminApiError('status', 'unauthorized', 401))
    reportSessionProblem(new AdminApiError('status', 'conflict', 409))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('ended')
    off()
    reportSessionProblem(new AdminApiError('status', 'unauthorized', 401))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('shouldRetry (queries)', () => {
  it('retries a transient failure once', () => {
    expect(shouldRetry(0, new AdminApiError('status', 'network'))).toBe(true)
    expect(shouldRetry(0, new AdminApiError('status', 'internal', 500))).toBe(true)
    expect(shouldRetry(1, new AdminApiError('status', 'network'))).toBe(false)
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true)
  })

  it('never retries definite answers or session problems', () => {
    expect(shouldRetry(0, new AdminApiError('status', 'forbidden', 403))).toBe(false)
    expect(shouldRetry(0, new AdminApiError('status', 'bad_request', 400))).toBe(false)
    expect(shouldRetry(0, new AdminApiError('status', 'unauthorized', 401))).toBe(false)
    expect(shouldRetry(0, { code: 'PGRST303' })).toBe(false)
    expect(shouldRetry(0, { code: '23514', status: 400 })).toBe(false)
    expect(shouldRetry(0, new NoRowsError())).toBe(false)
  })
})
