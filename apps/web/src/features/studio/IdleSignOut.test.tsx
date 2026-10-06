import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../lib/i18n.ts'
import { saveLastActivity } from '../../lib/idle.ts'
import { clearIdleSignOut, useIdleSignOutNotice } from '../../lib/session.ts'
import { fakeSession, type FakeStudioDb } from './fakeStudioDb.ts'
import { IdleSignOut } from './IdleSignOut.tsx'
import { renderRoute } from './renderRoute.tsx'

const mock = vi.hoisted(() => ({ fake: null as FakeStudioDb | null }))

vi.mock('../../lib/db.ts', async () => {
  const { createFakeStudioDb } = await import('./fakeStudioDb.ts')
  mock.fake = createFakeStudioDb()
  return { studioDb: mock.fake.db, imageSrc: () => undefined, onImageError: () => {} }
})

const fake = () => mock.fake!
const MIN = 60_000

const StudioPage = () => (
  <div>
    <p>studio page</p>
    <IdleSignOut enabled />
  </div>
)

/** What /login will say (it reads the same notice). */
function Notice() {
  return <p>{useIdleSignOutNotice() ? 'notice: idle' : 'notice: none'}</p>
}

async function openStudio() {
  render(<Notice />)
  renderRoute('/studio', '/studio', StudioPage)
  await screen.findByText('studio page')
}

const warning = () => screen.getByRole('dialog', { name: 'Still there?' }) as HTMLDialogElement

describe('IdleSignOut', () => {
  beforeAll(async () => {
    window.scrollTo = () => {}
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    // Only the hook's clock: the router and Testing Library keep real timeouts.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-10-05T02:00:00Z'))
    window.sessionStorage.clear()
    saveLastActivity()
    clearIdleSignOut()
    fake().setSession(fakeSession('aal1'), 'INITIAL_SESSION')
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('warns two minutes before; "Stay signed in" (the focused choice) keeps the session', async () => {
    await openStudio()
    act(() => vi.advanceTimersByTime(28 * MIN + 1000))
    const dialog = warning()
    expect(dialog.open).toBe(true)
    expect(within(dialog).getByText("For safety, you'll be signed out in 1:59 because there has been no activity for a while.")).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Stay signed in' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay signed in' }))
    expect(dialog.open).toBe(false)
    act(() => vi.advanceTimersByTime(29 * MIN))
    expect(fake().db.auth.signOut).not.toHaveBeenCalled()
  })

  it('signs this browser out after 30 minutes without input, and /login says why', async () => {
    await openStudio()
    expect(screen.getByText('notice: none')).toBeTruthy()
    act(() => vi.advanceTimersByTime(30 * MIN + 1000))
    expect(await screen.findByText('route:/login')).toBeTruthy()
    expect(fake().db.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(fake().db.auth.signOut).toHaveBeenCalledTimes(1)
    expect(screen.getByText('notice: idle')).toBeTruthy()
  })

  it('"Sign out now" signs out at once, without the idle notice', async () => {
    await openStudio()
    act(() => vi.advanceTimersByTime(28 * MIN + 1000))
    fireEvent.click(within(warning()).getByRole('button', { name: 'Sign out now' }))
    expect(await screen.findByText('route:/login')).toBeTruthy()
    expect(fake().db.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(screen.getByText('notice: none')).toBeTruthy()
  })
})
