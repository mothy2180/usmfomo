import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSession, okStatusJson, ORG, type FakeStudioDb } from '../../features/studio/fakeStudioDb.ts'
import { renderRoute } from '../../features/studio/renderRoute.tsx'
import type { PostRow } from '../../features/studio/types.ts'
import i18n from '../../lib/i18n.ts'
import { saveLastActivity } from '../../lib/idle.ts'
import { StudioHome } from './StudioHome.tsx'

const mock = vi.hoisted(() => ({
  fake: null as FakeStudioDb | null,
  posts: [] as PostRow[],
  ports: {
    upload: async () => {},
    remove: async (_paths: string[]) => {},
    insert: async () => ({ id: 'x' }),
    update: async () => {},
    delete: async (_id: string) => {},
  },
}))

vi.mock('../../lib/db.ts', async () => {
  const { createFakeStudioDb } = await import('../../features/studio/fakeStudioDb.ts')
  mock.fake = createFakeStudioDb()
  return {
    studioDb: mock.fake.db,
    imageSrc: (path: string | null | undefined) => (path ? `/i/${path}` : undefined),
    onImageError: () => {},
  }
})
vi.mock('../../env.ts', () => ({ CONTACT_URL: '' }))
vi.mock('../../features/studio/ports.ts', () => ({
  studioPorts: mock.ports,
  fetchOwnPosts: async () => mock.posts,
}))

const fake = () => mock.fake!
const NOW = new Date('2026-10-05T02:00:00Z') // Mon 5 Oct, 10:00 MYT
const POSTER = `${ORG.id}/44444444-4444-4444-8444-444444444444.webp`
const THUMB = `${ORG.id}/44444444-4444-4444-8444-444444444444-thumb.webp`

const post = (id: string, title: string, starts: string, ends: string, over: Partial<PostRow> = {}): PostRow => ({
  id,
  org_id: ORG.id,
  campus: 'main',
  title,
  venue: 'DK A',
  description: null,
  link_url: null,
  starts_at: starts,
  ends_at: ends,
  poster_path: null,
  thumb_path: null,
  cancelled_at: null,
  hidden_at: null,
  details_changed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
})

const UPCOMING = post('00000000-0000-4000-8000-000000000001', 'Hack Night', '2026-10-11T12:00:00Z', '2026-10-11T14:00:00Z', { poster_path: POSTER, thumb_path: THUMB })
const NOW_ON = post('00000000-0000-4000-8000-000000000002', 'Robot Expo', '2026-10-05T01:00:00Z', '2026-10-05T05:00:00Z')
const HIDDEN = post('00000000-0000-4000-8000-000000000003', 'Hidden Talk', '2026-10-12T12:00:00Z', '2026-10-12T14:00:00Z', { hidden_at: '2026-10-04T00:00:00Z' })
const ENDED = post('00000000-0000-4000-8000-000000000004', 'Old Meetup', '2026-10-04T12:00:00Z', '2026-10-04T14:00:00Z')

function item(title: string) {
  return screen.getByRole('heading', { level: 3, name: title }).closest('li')!
}

describe('StudioHome', () => {
  beforeAll(async () => {
    window.scrollTo = () => {}
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    window.localStorage.clear()
    window.sessionStorage.clear()
    // This tab had input just now (see lib/idle.ts).
    saveLastActivity()
    mock.posts = [UPCOMING, NOW_ON, HIDDEN, ENDED]
    fake().setSession(fakeSession('aal1'), 'INITIAL_SESSION')
    fake().db.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(fake().aal('aal1', 'aal1'))
    fake().db.rpc.mockResolvedValue({ data: okStatusJson({ live: 12, new_24h: 3 }), error: null })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the limits and labels every post', async () => {
    renderRoute('/studio', '/studio', StudioHome)
    expect(await screen.findByRole('heading', { level: 3, name: 'Hack Night' })).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Posting limits' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Live 12/15',
      '·New in last 24 h 3/5',
    ])
    expect(within(item('Hack Night')).getByText('Upcoming')).toBeTruthy()
    expect(within(item('Robot Expo')).getByText('Happening now')).toBeTruthy()
    expect(within(item('Hidden Talk')).getByText('Hidden by the usmfomo admin')).toBeTruthy()
    expect(within(item('Old Meetup')).getByText('Ended (being cleaned up)')).toBeTruthy()
    // Public page only while students can see it; no editing an ended post.
    expect(within(item('Hack Night')).getByRole('link', { name: 'View public page: Hack Night' })).toBeTruthy()
    expect(within(item('Hidden Talk')).queryByRole('link', { name: /View public page/ })).toBeNull()
    expect(within(item('Old Meetup')).queryByRole('link', { name: /Edit/ })).toBeNull()
    expect(within(item('Hack Night')).getByRole('img', { name: 'Poster: Hack Night' }).getAttribute('src')).toBe(`/i/${THUMB}`)
    expect(screen.getByRole('link', { name: 'New post' }).getAttribute('href')).toBe('/studio/new')
  })

  it('disables New post and Edit while posting is paused, but not Delete', async () => {
    fake().db.rpc.mockResolvedValue({ data: okStatusJson({ posting_enabled: false }), error: null })
    renderRoute('/studio', '/studio', StudioHome)
    await screen.findByRole('heading', { level: 3, name: 'Hack Night' })
    expect(screen.getAllByText('Posting is paused by the usmfomo admin. Your live posts stay visible.').length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: 'New post' }) as HTMLButtonElement).disabled).toBe(true)
    const edit = within(item('Hack Night')).getByRole('button', { name: 'Edit: Hack Night' }) as HTMLButtonElement
    expect(edit.disabled).toBe(true)
    expect((within(item('Hack Night')).getByRole('button', { name: 'Delete: Hack Night' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('explains a full daily limit with the next slot', async () => {
    fake().db.rpc.mockResolvedValue({ data: okStatusJson({ new_24h: 5, next_slot_at: '2026-10-05T06:20:00Z' }), error: null })
    renderRoute('/studio', '/studio', StudioHome)
    expect(await screen.findByText("You've made 5 new posts in the last 24 hours. Next slot: 14:20.")).toBeTruthy()
    expect(screen.getByText('next slot 14:20')).toBeTruthy()
  })

  it('deletes after confirmation: files first, then the row', async () => {
    const order: string[] = []
    mock.ports.remove = async (paths) => void order.push(`remove ${paths.join(',')}`)
    mock.ports.delete = async (id) => void order.push(`delete ${id}`)
    renderRoute('/studio', '/studio', StudioHome)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete: Hack Night' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this post?' })
    expect(within(dialog).getByText(/“Hack Night” and its poster will be removed straight away/)).toBeTruthy()
    // The safe choice has focus.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep it' }))
    mock.posts = [NOW_ON, HIDDEN, ENDED]
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete post' }))
    expect(await screen.findByText('Deleted “Hack Night”.')).toBeTruthy()
    expect(order).toEqual([`remove ${POSTER},${THUMB}`, `delete ${UPCOMING.id}`])
  })

  it('has a dismissible first-login checklist', async () => {
    mock.posts = []
    renderRoute('/studio', '/studio', StudioHome)
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Read the posting rules' }).getAttribute('href')).toBe('/rules')
    expect(screen.getByRole('link', { name: 'Add 2FA for each committee member who posts' }).getAttribute('href')).toBe('/studio/settings')
    expect(await screen.findByText('No posts yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide this checklist' }))
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
    cleanup()
    renderRoute('/studio', '/studio', StudioHome)
    await screen.findByText('No posts yet.')
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
  })

  it('turns the owner account away and signs it out of this browser', async () => {
    fake().db.rpc.mockResolvedValue({ data: { state: 'owner', username: 'boss' }, error: null })
    renderRoute('/studio', '/studio', StudioHome)
    expect(await screen.findByText('This is the owner account — use the owner console.')).toBeTruthy()
    expect(fake().db.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(fake().db.auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('sends a session that still needs its code to /login/mfa', async () => {
    fake().db.rpc.mockResolvedValue({ data: { state: 'mfa_required', username: 'robotik' }, error: null })
    renderRoute('/studio', '/studio', StudioHome)
    expect(await screen.findByText('route:/login/mfa')).toBeTruthy()
  })

  it('stays in the studio when every 2FA device was removed elsewhere (no loop to /login/mfa)', async () => {
    // The cached session still lists a device; the database knows it is gone.
    fake().db.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(fake().aal('aal1', 'aal2'))
    fake().db.rpc.mockResolvedValue({ data: okStatusJson({ factors: 0 }), error: null })
    renderRoute('/studio', '/studio', StudioHome)
    expect(await screen.findByRole('heading', { level: 3, name: 'Hack Night' })).toBeTruthy()
    expect(screen.queryByText('route:/login/mfa')).toBeNull()
    // The stale cached session is refreshed, so supabase-js agrees.
    expect(fake().db.auth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('signs out a session restored after 30 minutes without input, before using it', async () => {
    // A closed tab reopened (or a browser session restored) on a lab PC.
    saveLastActivity(NOW.getTime() - 31 * 60_000)
    renderRoute('/studio', '/studio', StudioHome)
    expect(await screen.findByText('route:/login')).toBeTruthy()
    expect(fake().db.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(fake().db.rpc).not.toHaveBeenCalled()
  })

  it('never uses a session that comes back after the tab went 30 minutes without input', async () => {
    renderRoute('/studio', '/studio', StudioHome)
    await screen.findByRole('heading', { level: 3, name: 'Hack Night' })
    // E.g. a restored tab that was offline: its token refreshes once it is back online.
    saveLastActivity(NOW.getTime() - 31 * 60_000)
    act(() => fake().setSession(fakeSession('aal1'), 'TOKEN_REFRESHED'))
    expect(await screen.findByText('route:/login')).toBeTruthy()
    expect(fake().db.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('asks to sign out again when that failed, and never says closing the tab is enough', async () => {
    fake().db.auth.signOut.mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } })
    renderRoute('/studio', '/studio', StudioHome)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't reach usmfomo to sign out. Check your connection and press Sign out again. On a shared computer, don't leave until you're signed out: closing the tab isn't enough.",
    )
  })
})
