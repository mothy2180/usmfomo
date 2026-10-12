import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSession, okStatusJson, type FakeStudioDb } from '../../features/studio/fakeStudioDb.ts'
import { renderRoute } from '../../features/studio/renderRoute.tsx'
import i18n from '../../lib/i18n.ts'
import { saveLastActivity } from '../../lib/idle.ts'
import { SettingsPage } from './SettingsPage.tsx'

const mock = vi.hoisted(() => ({ fake: null as FakeStudioDb | null }))

vi.mock('../../lib/db.ts', async () => {
  const { createFakeStudioDb } = await import('../../features/studio/fakeStudioDb.ts')
  mock.fake = createFakeStudioDb()
  return { studioDb: mock.fake.db, imageSrc: () => undefined, onImageError: () => {} }
})
vi.mock('../../env.ts', () => ({ CONTACT_URL: '' }))

const fake = () => mock.fake!

describe('SettingsPage', () => {
  beforeAll(async () => {
    window.scrollTo = () => {}
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    saveLastActivity()
    fake().setSession(fakeSession(), 'INITIAL_SESSION')
    fake().db.rpc.mockResolvedValue({ data: okStatusJson(), error: null })
  })
  afterEach(() => {
    cleanup()
  })

  it('explains how the password is changed, and nothing about 2FA', async () => {
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    expect(await screen.findByRole('heading', { level: 2, name: 'Password' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Kelab Robotik')).toBeTruthy()
    expect(screen.getByText(/The usmfomo admin sets your club's password/)).toBeTruthy()
    // A password changed without asking is a takeover sign (any club session can change it).
    expect(screen.getByText(/If the password stops working and nobody asked for a change, tell the admin straight away/)).toBeTruthy()
    expect(screen.queryByText(/2FA|device|authenticator/i)).toBeNull()
    // Still reachable from the studio navigation.
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/studio/settings')
  })

  it('sends a visitor without a session to /login', async () => {
    fake().setSession(null, 'SIGNED_OUT')
    renderRoute('/studio/settings', '/studio/settings', SettingsPage)
    expect(await screen.findByText('route:/login')).toBeTruthy()
  })
})
