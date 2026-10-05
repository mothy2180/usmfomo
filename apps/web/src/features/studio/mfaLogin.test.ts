import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TotpFactor } from './factors.ts'
import { mfaStep, readLastFactor, saveLastFactor } from './mfaLogin.ts'

const factor: TotpFactor = { id: 'f1', friendly_name: 'Aina', factor_type: 'totp', status: 'verified', created_at: '2026-10-01T00:00:00Z' }

describe('mfaStep', () => {
  it('waits for the session and the device list', () => {
    expect(mfaStep(false, false, undefined)).toBe('wait')
    expect(mfaStep(true, true, undefined)).toBe('wait')
  })

  it('sends visitors without a session to the login page', () => {
    expect(mfaStep(true, false, undefined)).toBe('login')
    expect(mfaStep(true, false, { currentLevel: 'aal1', factors: [factor] })).toBe('login')
  })

  it('asks for a code at aal1 with a device', () => {
    expect(mfaStep(true, true, { currentLevel: 'aal1', factors: [factor] })).toBe('code')
  })

  it('goes on to the studio when there is nothing to verify', () => {
    expect(mfaStep(true, true, { currentLevel: 'aal2', factors: [factor] })).toBe('studio')
    // The last device was removed by another member meanwhile.
    expect(mfaStep(true, true, { currentLevel: 'aal1', factors: [] })).toBe('studio')
  })
})

describe('last used device', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('is remembered in this browser', () => {
    expect(readLastFactor()).toBeNull()
    saveLastFactor('f1')
    expect(readLastFactor()).toBe('f1')
  })

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => saveLastFactor('f1')).not.toThrow()
    expect(readLastFactor()).toBeNull()
  })
})
