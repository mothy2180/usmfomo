import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSession, type FakeStudioDb } from '../../features/studio/fakeStudioDb.ts'
import { readLastFactor } from '../../features/studio/mfaLogin.ts'
import { renderRoute } from '../../features/studio/renderRoute.tsx'
import i18n from '../../lib/i18n.ts'
import { MfaPage } from './MfaPage.tsx'

const mock = vi.hoisted(() => ({ fake: null as FakeStudioDb | null }))

vi.mock('../../lib/db.ts', async () => {
  const { createFakeStudioDb } = await import('../../features/studio/fakeStudioDb.ts')
  mock.fake = createFakeStudioDb()
  return { studioDb: mock.fake.db, imageSrc: () => undefined, onImageError: () => {} }
})
vi.mock('../../env.ts', () => ({ CONTACT_URL: '' }))

const fake = () => mock.fake!
const factor = (id: string, name: string, created: string) => ({
  id,
  friendly_name: name,
  factor_type: 'totp',
  status: 'verified',
  created_at: created,
  updated_at: created,
})
const AINA = factor('f-aina', 'Aina (Secretary)', '2026-09-01T00:00:00Z')
const HAFIZ = factor('f-hafiz', 'Hafiz', '2026-09-02T00:00:00Z')

function devices(...list: ReturnType<typeof factor>[]) {
  fake().db.auth.mfa.listFactors.mockResolvedValue({ data: { all: list, totp: list }, error: null })
}

const typeCode = (code: string) => fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: code } })
const verify = () => fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

describe('MfaPage', () => {
  beforeAll(async () => {
    window.scrollTo = () => {}
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    fake().setSession(fakeSession('aal1'), 'INITIAL_SESSION')
    fake().db.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(fake().aal('aal1', 'aal2'))
    fake().db.auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null })
    devices(AINA, HAFIZ)
  })
  afterEach(cleanup)

  it('asks whose phone it is when there are several devices', async () => {
    renderRoute('/login/mfa', '/login/mfa', MfaPage)
    const group = await screen.findByRole('group', { name: 'Whose phone are you using?' })
    expect(group).toBeTruthy()
    const input = screen.getByLabelText('6-digit code')
    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(input.getAttribute('autocomplete')).toBe('one-time-code')
    typeCode('123456')
    verify()
    expect(await screen.findByText("Choose whose phone you're using.")).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Aina (Secretary)' }))
    expect(fake().db.auth.mfa.challengeAndVerify).not.toHaveBeenCalled()
  })

  it('verifies the chosen device, remembers it and opens the studio', async () => {
    renderRoute('/login/mfa', '/login/mfa', MfaPage)
    fireEvent.click(await screen.findByRole('radio', { name: 'Hafiz' }))
    // Pasted with a space: still accepted.
    typeCode('123 456')
    expect((screen.getByLabelText('6-digit code') as HTMLInputElement).value).toBe('123456')
    verify()
    expect(await screen.findByText('route:/studio')).toBeTruthy()
    expect(fake().db.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-hafiz', code: '123456' })
    expect(readLastFactor()).toBe('f-hafiz')
  })

  it('preselects the device last used in this browser', async () => {
    window.localStorage.setItem('usmfomo.studio.lastFactor', 'f-aina')
    renderRoute('/login/mfa', '/login/mfa', MfaPage)
    expect(((await screen.findByRole('radio', { name: 'Aina (Secretary)' })) as HTMLInputElement).checked).toBe(true)
  })

  it('needs all six digits, and explains a wrong code', async () => {
    devices(AINA)
    fake().db.auth.mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { code: 'mfa_verification_failed', status: 422 } })
    renderRoute('/login/mfa', '/login/mfa', MfaPage)
    await screen.findByLabelText('6-digit code')
    // One device: no question about whose phone it is.
    expect(screen.queryByRole('group', { name: 'Whose phone are you using?' })).toBeNull()
    typeCode('12345')
    verify()
    expect(await screen.findByText('Enter all 6 digits.')).toBeTruthy()
    typeCode('654321')
    verify()
    expect((await screen.findByRole('alert')).textContent).toBe("That code didn't work — use the newest code and check your phone's clock.")
    expect((screen.getByLabelText('6-digit code') as HTMLInputElement).value).toBe('')
    expect(fake().db.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-aina', code: '654321' })
  })

  it('offers a fresh sign-in when the session ended meanwhile', async () => {
    devices(AINA)
    fake().db.auth.mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { code: 'session_not_found', status: 403 } })
    renderRoute('/login/mfa', '/login/mfa', MfaPage)
    await screen.findByLabelText('6-digit code')
    typeCode('654321')
    verify()
    expect((await screen.findByRole('alert')).textContent).toBe('Your session ended. Please sign in again.')
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe('/login')
  })

  it('has help for a lost phone and a way back to another account', async () => {
    renderRoute('/login/mfa', '/login/mfa', MfaPage)
    expect(await screen.findByRole('heading', { name: 'Lost your phone?' })).toBeTruthy()
    expect(screen.getByText(/remove your device in Settings/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }))
    expect(await screen.findByText('route:/login')).toBeTruthy()
    expect(fake().db.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('moves on when there is nothing to verify, or no session', async () => {
    fake().db.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(fake().aal('aal2', 'aal2'))
    renderRoute('/login/mfa', '/login/mfa', MfaPage)
    expect(await screen.findByText('route:/studio')).toBeTruthy()
    cleanup()
    fake().setSession(null, 'SIGNED_OUT')
    renderRoute('/login/mfa', '/login/mfa', MfaPage)
    expect(await screen.findByText('route:/login')).toBeTruthy()
  })
})
