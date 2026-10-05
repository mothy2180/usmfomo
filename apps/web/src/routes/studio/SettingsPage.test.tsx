import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSession, okStatusJson, type FakeStudioDb } from '../../features/studio/fakeStudioDb.ts'
import { renderRoute } from '../../features/studio/renderRoute.tsx'
import i18n from '../../lib/i18n.ts'
import { SettingsPage } from './SettingsPage.tsx'

const mock = vi.hoisted(() => ({ fake: null as FakeStudioDb | null }))

vi.mock('../../lib/db.ts', async () => {
  const { createFakeStudioDb } = await import('../../features/studio/fakeStudioDb.ts')
  mock.fake = createFakeStudioDb()
  return { studioDb: mock.fake.db, imageSrc: () => undefined, onImageError: () => {} }
})
vi.mock('../../env.ts', () => ({ CONTACT_URL: '' }))

const fake = () => mock.fake!
const NOW = new Date('2026-10-05T02:00:00Z')
const factor = (id: string, name: string, created: string, status = 'verified') => ({
  id,
  friendly_name: name,
  factor_type: 'totp',
  status,
  created_at: created,
  updated_at: created,
})
const AINA = factor('f-aina', 'Aina (Secretary)', '2026-09-01T00:00:00Z')
const HAFIZ = factor('f-hafiz', 'Hafiz', '2026-10-04T20:00:00Z') // 5 Oct in Malaysia, recent

function devices(...list: ReturnType<typeof factor>[]) {
  fake().db.auth.mfa.listFactors.mockResolvedValue({ data: { all: list, totp: list.filter((f) => f.status === 'verified') }, error: null })
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect fill="#000" width="1" height="1"/></svg>'
const SECRET = 'JBSWY3DPEHPK3PXP'
const URI = `otpauth://totp/usmfomo:robotik@usmfomo.pages.dev?issuer=usmfomo&secret=${SECRET}`

describe('SettingsPage', () => {
  beforeAll(async () => {
    window.scrollTo = () => {}
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    fake().setSession(fakeSession('aal2'), 'INITIAL_SESSION')
    fake().db.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(fake().aal('aal2', 'aal2'))
    fake().db.rpc.mockResolvedValue({ data: okStatusJson({ factors: 2 }), error: null })
    devices(AINA, HAFIZ)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('explains 2FA for a committee and lists the devices, flagging recent ones', async () => {
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    // The guard shows the page frame (h1) while it checks the session.
    expect(await screen.findByText(/Each committee member who posts adds their own phone/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Kelab Robotik')).toBeTruthy()
    expect(screen.getByText(/Enrol everyone in one sitting/)).toBeTruthy()
    expect(screen.getByText(/Passwords are managed by the usmfomo admin/)).toBeTruthy()
    const region = screen.getByRole('region', { name: 'Devices' })
    const items = within(await within(region).findByRole('list')).getAllByRole('listitem')
    expect(items.map((li) => li.querySelector('p')?.textContent)).toEqual(['Aina (Secretary)', 'Hafiz'])
    expect(within(items[0]!).getByText('Added 1 Sept 2026')).toBeTruthy()
    expect(within(items[1]!).getByText('Added 5 Oct 2026')).toBeTruthy()
    expect(within(items[1]!).getByText('Added in the last 7 days')).toBeTruthy()
    expect(within(items[0]!).queryByText('Added in the last 7 days')).toBeNull()
    expect(screen.queryByText(/Only one device is enrolled/)).toBeNull()
  })

  it('warns while only one device is enrolled', async () => {
    devices(AINA)
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    expect(await screen.findByText(/Only one device is enrolled/)).toBeTruthy()
  })

  it('adds a device: name -> QR code, setup key, app link -> first code', async () => {
    devices()
    fake().db.auth.mfa.enroll.mockResolvedValueOnce({
      data: { id: 'f-new', type: 'totp', friendly_name: 'Siti', totp: { qr_code: `data:image/svg+xml;utf-8,${SVG}`, secret: SECRET, uri: URI } },
      error: null,
    })
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    expect(await screen.findByText('No devices yet. Anyone with the password can sign in.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Whose phone is this?'), { target: { value: '  Siti  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))

    expect(await screen.findByRole('heading', { name: "Set up Siti's phone" })).toBeTruthy()
    expect(fake().db.auth.mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Siti', issuer: 'usmfomo' })
    const qr = screen.getByRole('img', { name: 'QR code for adding usmfomo to an authenticator app' })
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2010%2010%22/)
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open in authenticator app' }).getAttribute('href')).toBe(URI)

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and add' }))
    expect(await screen.findByText("Added Siti's device.")).toBeTruthy()
    expect(fake().db.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-new', code: '123456' })
    // Ready for the next committee member.
    expect((screen.getByLabelText('Whose phone is this?') as HTMLInputElement).value).toBe('')
  })

  it('refuses a name already in use without asking Auth', async () => {
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    await screen.findByText('Hafiz')
    fireEvent.change(screen.getByLabelText('Whose phone is this?'), { target: { value: 'hafiz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))
    expect(await screen.findByText("There's already a device with that name. Use a different name.")).toBeTruthy()
    expect(fake().db.auth.mfa.enroll).not.toHaveBeenCalled()
  })

  it('cancelling a setup removes the unconfirmed device', async () => {
    devices()
    fake().db.auth.mfa.enroll.mockResolvedValueOnce({
      data: { id: 'f-new', type: 'totp', totp: { qr_code: SVG, secret: SECRET, uri: URI } },
      error: null,
    })
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    await screen.findByText('No devices yet. Anyone with the password can sign in.')
    fireEvent.change(screen.getByLabelText('Whose phone is this?'), { target: { value: 'Siti' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel setup' }))
    await waitFor(() => expect(fake().db.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-new' }))
    expect(screen.getByRole('button', { name: 'Start setup' })).toBeTruthy()
  })

  it('removes a device after confirmation and refreshes the session', async () => {
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove: Hafiz' }))
    const dialog = screen.getByRole('dialog', { name: "Remove Hafiz's device?" })
    expect(within(dialog).getByText(/you'll be asked for a code from another device/)).toBeTruthy()
    devices(AINA)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove device' }))
    expect(await screen.findByText("Removed Hafiz's device.")).toBeTruthy()
    expect(fake().db.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-hafiz' })
    expect(fake().db.auth.refreshSession).toHaveBeenCalled()
  })

  it('warns before removing the last device', async () => {
    devices(AINA)
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove: Aina (Secretary)' }))
    expect(within(screen.getByRole('dialog')).getByText(/This is the last device: 2FA will be off/)).toBeTruthy()
  })

  it('sends a session that has not passed 2FA to the code step', async () => {
    fake().db.auth.mfa.unenroll.mockResolvedValueOnce({ data: null, error: { code: 'insufficient_aal', status: 422 } })
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove: Hafiz' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove device' }))
    expect(await screen.findByText('route:/login/mfa')).toBeTruthy()
  })
})
