import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import type { OrgType } from '@usmfomo/shared/config'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { DbCall, DbHandler } from '../../features/public/testDb.ts'
import type { Notice, OrgSummary, PostCard } from '../../features/public/types.ts'
import i18n from '../../lib/i18n.ts'
import { parseDashboardSearch } from '../../router.tsx'
import { DashboardPage } from './DashboardPage.tsx'

const mock = vi.hoisted(() => ({ handler: null as DbHandler | null, calls: [] as DbCall[] }))

vi.mock('../../lib/db.ts', async () => {
  const { createFakeDb } = await import('../../features/public/testDb.ts')
  const fake = createFakeDb((call) => {
    if (!mock.handler) throw new Error('no handler set')
    return mock.handler(call)
  })
  mock.calls = fake.calls
  return {
    publicDb: fake.db,
    imageSrc: (path: string | null | undefined) => (path ? `/i/${path}` : undefined),
    onImageError: () => {},
  }
})
vi.mock('../../env.ts', () => ({ CONTACT_URL: '' }))

const NOW = new Date('2026-10-11T04:00:00Z') // Sun 11 Oct, 12:00 MYT

const CLUB: OrgSummary = { id: '22222222-2222-4222-8222-222222222222', name: 'Robotics Club', slug: 'robotics-club', type: 'club', campus: 'engineering' }
const SCHOOL: OrgSummary = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'School of Computer Sciences',
  slug: 'school-of-computer-sciences',
  type: 'school',
  campus: 'main',
}

let seq = 0
function post(org: OrgSummary, title: string, starts_at: string, ends_at: string): PostCard {
  seq += 1
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    org_id: org.id,
    org_name: org.name,
    org_slug: org.slug,
    org_type: org.type,
    campus: org.campus,
    title,
    venue: 'Main Hall',
    starts_at,
    ends_at,
    thumb_path: null,
    cancelled_at: null,
    details_changed_at: null,
    total: 0,
  }
}

const NOTICE: Notice = {
  id: 'e077e063-3a0c-4da7-9a7c-abbb26f11a9e',
  title: 'Welcome to usmfomo',
  body: 'Club and school events at USM in one place.',
  link_url: null,
  starts_at: '2026-10-10T00:00:00Z',
  ends_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
}

const ok = (data: unknown) => ({ data, error: null })

type SearchArgs = { p_type: OrgType; p_q?: string; p_campus?: string; p_org?: string; p_limit: number; p_offset: number }

/** A small in-memory search_posts plus the other public reads. */
function serve(rows: Partial<Record<OrgType, PostCard[]>>, opts: { notices?: Notice[]; readsEnabled?: boolean } = {}): DbHandler {
  return (call) => {
    if (call.fn === 'search_posts') {
      const a = call.args as SearchArgs
      const q = a.p_q?.toLowerCase()
      const all = (rows[a.p_type] ?? []).filter(
        (r) => (!q || r.title.toLowerCase().includes(q)) && (!a.p_campus || r.campus === a.p_campus) && (!a.p_org || r.org_id === a.p_org),
      )
      return ok(all.slice(a.p_offset, a.p_offset + a.p_limit).map((r) => ({ ...r, total: all.length })))
    }
    if (call.table === 'notices') return ok(opts.notices ?? [])
    if (call.table === 'orgs') return ok([CLUB, SCHOOL])
    if (call.table === 'site_settings') return ok({ public_reads_enabled: opts.readsEnabled ?? true })
    throw new Error(`unexpected call: ${JSON.stringify(call)}`)
  }
}

const searchCalls = (type: OrgType) => mock.calls.filter((c) => c.fn === 'search_posts' && c.args?.p_type === type)

/** A response held back until the test releases it. */
function holdBack() {
  let release = () => {}
  const until = new Promise<void>((resolve) => {
    release = resolve
  })
  return { until, release }
}

/** What the results live region tells screen readers right now. */
const summaryText = () => document.querySelector('main > p[aria-live]')?.textContent ?? null

/** Every text the results live region holds, in order, until the test ends. */
function recordSummary(): string[] {
  const said: string[] = []
  const observer = new MutationObserver(() => {
    const text = summaryText()
    if (text !== null && text !== said.at(-1)) said.push(text)
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  onTestFinished(() => observer.disconnect())
  return said
}

/** The notice on screen (the live region can say the same words). */
const findHiddenNotice = () => screen.findByText('Events are hidden for a while.', { ignore: '[aria-live]' })

async function renderDashboard(url = '/dashboard') {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', validateSearch: parseDashboardSearch, component: DashboardPage }),
    createRoute({ getParentRoute: () => rootRoute, path: '/e/$id', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/o/$slug', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/rules', component: () => null }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [url] }) })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await screen.findByRole('heading', { level: 1, name: "What's on" })
  return { ...view, router }
}

describe('DashboardPage', () => {
  beforeAll(async () => {
    window.scrollTo = () => {} // the router restores scroll; jsdom has no scrollTo
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    window.localStorage.clear()
    mock.calls.length = 0
    mock.handler = null
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('shows notices, Clubs | Schools tabs with counts, and the active panel in sections', async () => {
    mock.handler = serve(
      {
        club: [
          post(CLUB, 'Robot demo', '2026-10-11T03:00:00Z', '2026-10-11T05:00:00Z'),
          post(CLUB, 'Robot race', '2026-10-12T01:00:00Z', '2026-10-12T03:00:00Z'),
        ],
        school: [post(SCHOOL, 'FYP talk', '2026-10-30T01:00:00Z', '2026-10-30T03:00:00Z')],
      },
      { notices: [NOTICE] },
    )
    await renderDashboard()

    expect(await screen.findByRole('heading', { name: 'Welcome to usmfomo' })).toBeTruthy()
    const clubs = await screen.findByRole('tab', { name: 'Clubs (2)' })
    expect(clubs.getAttribute('aria-selected')).toBe('true')
    expect((await screen.findByRole('tab', { name: 'Schools (1)' })).getAttribute('aria-selected')).toBe('false')

    const panel = screen.getByRole('tabpanel', { name: 'Clubs (2)' })
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Happening now', 'Tomorrow'])
    expect(within(panel).getAllByRole('article')).toHaveLength(2)
    expect(within(panel).getByText('Happening now', { selector: 'span' })).toBeTruthy()
    // The Schools panel is there but hidden until its tab is chosen.
    expect(screen.queryByText('FYP talk')).not.toBeNull()
    expect(screen.queryByRole('tabpanel', { name: 'Schools (1)' })).toBeNull()

    // p_limit 20 from offset 0, for each type; no organiser list yet.
    expect(searchCalls('club')[0]?.args).toEqual({ p_type: 'club', p_limit: 20, p_offset: 0 })
    expect(searchCalls('school')[0]?.args).toEqual({ p_type: 'school', p_limit: 20, p_offset: 0 })
    expect(mock.calls.some((c) => c.table === 'orgs')).toBe(false)
  })

  it('reflects the chosen tab in the URL and brings it back on the next visit', async () => {
    mock.handler = serve({ club: [], school: [post(SCHOOL, 'FYP talk', '2026-10-30T01:00:00Z', '2026-10-30T03:00:00Z')] })
    const first = await renderDashboard()
    fireEvent.click(await screen.findByRole('tab', { name: /Schools/ }))
    await waitFor(() => expect(first.router.state.location.search).toEqual({ tab: 'school' }))
    expect(window.localStorage.getItem('usmfomo.dashboard.tab')).toBe('school')
    expect(within(await screen.findByRole('tabpanel', { name: 'Schools (1)' })).getByText('FYP talk')).toBeTruthy()
    first.unmount()

    const second = await renderDashboard()
    await waitFor(() => expect(second.router.state.location.search).toEqual({ tab: 'school' }))
    expect(screen.getByRole('tab', { name: /Schools/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('brings back the remembered campus before the first request, not after', async () => {
    window.localStorage.setItem('usmfomo.dashboard.campus', 'engineering')
    mock.handler = serve({ club: [post(CLUB, 'Robot race', '2026-10-12T01:00:00Z', '2026-10-12T03:00:00Z')], school: [] })
    const { router } = await renderDashboard()
    await waitFor(() => expect(router.state.location.search).toEqual({ campus: 'engineering' }))
    expect(within(await screen.findByRole('tabpanel', { name: 'Clubs (1)' })).getByText('Robot race')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Campus' }) as HTMLSelectElement).value).toBe('engineering')
    // One request per list, both already narrowed to the remembered campus.
    const search = mock.calls.filter((c) => c.fn === 'search_posts')
    expect(search.map((c) => [c.args?.p_type, c.args?.p_campus])).toEqual([
      ['club', 'engineering'],
      ['school', 'engineering'],
    ])
  })

  it('never narrows a shared search link with the remembered campus', async () => {
    window.localStorage.setItem('usmfomo.dashboard.campus', 'engineering')
    mock.handler = serve({ club: [post(CLUB, 'Robot race', '2026-10-12T01:00:00Z', '2026-10-12T03:00:00Z')], school: [] })
    const { router } = await renderDashboard('/dashboard?q=robot')
    await screen.findByRole('tabpanel', { name: 'Clubs (1)' })
    expect(router.state.location.search).toEqual({ q: 'robot' })
    expect(searchCalls('club')[0]?.args?.p_campus).toBeUndefined()
  })

  it('pages with Show more and moves keyboard focus to the first new card', async () => {
    const start = Date.parse('2026-10-25T01:00:00Z')
    const iso = (ms: number) => new Date(ms).toISOString()
    const many = Array.from({ length: 23 }, (_, i) =>
      post(CLUB, `Workshop ${String(i + 1).padStart(2, '0')}`, iso(start + i * 600_000), iso(start + i * 600_000 + 3_600_000)),
    )
    mock.handler = serve({ club: many, school: [] })
    await renderDashboard()

    const panel = await screen.findByRole('tabpanel', { name: 'Clubs (23)' })
    expect(within(panel).getAllByRole('article')).toHaveLength(20)
    expect(within(panel).getByText('Showing 20 of 23')).toBeTruthy()
    const more = within(panel).getByRole('button', { name: 'Show more' })
    act(() => more.focus())
    fireEvent.click(more)

    await waitFor(() => expect(within(panel).getAllByRole('article')).toHaveLength(23))
    expect(searchCalls('club').map((c) => c.args?.p_offset)).toEqual([0, 20])
    expect(within(panel).queryByRole('button', { name: 'Show more' })).toBeNull()
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Workshop 21'))
  })

  it('shows the empty state with a pointer to the posting rules', async () => {
    mock.handler = serve({ club: [], school: [] })
    await renderDashboard()
    const panel = await screen.findByRole('tabpanel', { name: 'Clubs (0)' })
    expect(within(panel).getByText('No upcoming club events yet.')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Read the posting rules' }).getAttribute('href')).toBe('/rules')
    // Everything empty: it checks the public-read switch, which is on.
    await waitFor(() => expect(mock.calls.some((c) => c.table === 'site_settings')).toBe(true))
    expect(screen.queryByText('Events are hidden for a while.')).toBeNull()
  })

  it('says events are hidden (not "no events") when public reads are switched off', async () => {
    mock.handler = serve({}, { readsEnabled: false })
    await renderDashboard()
    expect(await findHiddenNotice()).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it.each([
    { name: 'a remembered campus', url: '/dashboard', remembered: true, noResults: 'No events match these filters.' },
    { name: 'a shared search link', url: '/dashboard?q=robot', remembered: false, noResults: 'Nothing matches “robot”.' },
  ])('says events are hidden with $name, and never tells screen readers "0 events"', async ({ url, remembered, noResults }) => {
    if (remembered) window.localStorage.setItem('usmfomo.dashboard.campus', 'engineering')
    // Public reads are off. Schools answers after Clubs, and the public-read
    // check after both.
    const schools = holdBack()
    const check = holdBack()
    const base = serve({}, { readsEnabled: false })
    mock.handler = async (call) => {
      if (call.fn === 'search_posts' && call.args?.p_type === 'school') await schools.until
      if (call.table === 'site_settings') await check.until
      return base(call)
    }
    const said = recordSummary()
    const { router } = await renderDashboard(url)
    await waitFor(() => expect(router.state.location.search).toEqual(remembered ? { campus: 'engineering' } : { q: 'robot' }))

    await screen.findByRole('tab', { name: 'Clubs (0)' })
    expect(summaryText()).toBe('') // Schools isn't in yet
    schools.release()
    await waitFor(() => expect(mock.calls.some((c) => c.table === 'site_settings')).toBe(true))
    expect(summaryText()).toBe('') // both empty, and the check isn't back
    check.release()

    expect(await findHiddenNotice()).toBeTruthy()
    expect(screen.queryByText(noResults)).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    await waitFor(() => expect(summaryText()).toBe('Events are hidden for a while.'))
    expect(said).toEqual(['', 'Events are hidden for a while.'])
  })

  it('says events are hidden with an organiser filter too (the other panel is skipped)', async () => {
    mock.handler = serve({}, { readsEnabled: false })
    await renderDashboard(`/dashboard?org=${SCHOOL.id}`)
    expect(await findHiddenNotice()).toBeTruthy()
    expect(searchCalls('school').some((c) => c.args?.p_org === SCHOOL.id)).toBe(true)
    await waitFor(() => expect(summaryText()).toBe('Events are hidden for a while.'))
  })

  it('tells screen readers the result counts once both lists are in', async () => {
    const schools = holdBack()
    const base = serve({ club: [post(CLUB, 'Robot race', '2026-10-12T01:00:00Z', '2026-10-12T03:00:00Z')], school: [] })
    mock.handler = async (call) => {
      if (call.fn === 'search_posts' && call.args?.p_type === 'school') await schools.until
      return base(call)
    }
    const said = recordSummary()
    await renderDashboard('/dashboard?q=robot')

    await screen.findByRole('tabpanel', { name: 'Clubs (1)' })
    expect(summaryText()).toBe('') // Schools isn't in yet
    schools.release()
    await waitFor(() => expect(summaryText()).toBe('1 club event, 0 school events'))
    expect(said).toEqual(['', '1 club event, 0 school events'])
    // One list has events, so there was nothing to check.
    expect(mock.calls.some((c) => c.table === 'site_settings')).toBe(false)
  })

  it('still tells screen readers the other count when one list fails', async () => {
    const base = serve({ school: [post(SCHOOL, 'Robot talk', '2026-10-30T01:00:00Z', '2026-10-30T03:00:00Z')] })
    mock.handler = (call) =>
      call.fn === 'search_posts' && call.args?.p_type === 'club'
        ? { data: null, error: { message: 'Failed to fetch', name: 'TypeError' } }
        : base(call)
    await renderDashboard('/dashboard?q=robot')
    expect((await screen.findByRole('alert')).textContent).toContain("Can't reach usmfomo.")
    await waitFor(() => expect(summaryText()).toBe('1 school event'))
  })

  it('says when nothing matches a search, and Clear filters brings everything back', async () => {
    const check = holdBack()
    const base = serve({ club: [post(CLUB, 'Robot race', '2026-10-12T01:00:00Z', '2026-10-12T03:00:00Z')], school: [] })
    mock.handler = async (call) => {
      if (call.table === 'site_settings') await check.until
      return base(call)
    }
    const { router } = await renderDashboard('/dashboard?q=zzz')
    const panel = await screen.findByRole('tabpanel', { name: 'Clubs (0)' })
    expect(within(panel).getByText('Nothing matches “zzz”.')).toBeTruthy()
    expect(searchCalls('club')[0]?.args?.p_q).toBe('zzz')
    // Both lists came back empty: screen readers hear "0 events" only once the
    // public-read check says reads are on.
    await waitFor(() => expect(mock.calls.some((c) => c.table === 'site_settings')).toBe(true))
    expect(summaryText()).toBe('')
    check.release()
    await waitFor(() => expect(summaryText()).toBe('0 club events, 0 school events'))
    expect(screen.queryByText('Events are hidden for a while.')).toBeNull()

    fireEvent.click(within(panel).getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(within(await screen.findByRole('tabpanel', { name: 'Clubs (1)' })).getByText('Robot race')).toBeTruthy()
    expect(summaryText()).toBe('')
  })

  it('shows an error with Try again', async () => {
    let failing = true
    const base = serve({ club: [post(CLUB, 'Robot race', '2026-10-12T01:00:00Z', '2026-10-12T03:00:00Z')], school: [] })
    mock.handler = (call) =>
      failing && call.fn === 'search_posts' && call.args?.p_type === 'club'
        ? { data: null, error: { message: 'Failed to fetch', name: 'TypeError' } }
        : base(call)
    await renderDashboard()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Can't reach usmfomo.")
    failing = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Robot race')).toBeTruthy()
  })

  it('fetches the organiser list only once the organiser filter is used', async () => {
    mock.handler = serve({ club: [], school: [] })
    await renderDashboard()
    await screen.findByRole('tabpanel', { name: 'Clubs (0)' })
    expect(mock.calls.some((c) => c.table === 'orgs')).toBe(false)

    act(() => screen.getByRole('combobox', { name: 'Organiser' }).focus())
    await waitFor(() => expect(mock.calls.some((c) => c.table === 'orgs')).toBe(true))
  })

  it('filters by an organiser from the URL and names it in the field', async () => {
    mock.handler = serve({
      club: [
        post(CLUB, 'Robot race', '2026-10-12T01:00:00Z', '2026-10-12T03:00:00Z'),
        post({ ...CLUB, id: '11111111-1111-4111-8111-111111111111', name: 'Chess Club' }, 'Chess night', '2026-10-12T11:00:00Z', '2026-10-12T13:00:00Z'),
      ],
      school: [],
    })
    await renderDashboard(`/dashboard?org=${CLUB.id}`)
    expect((await screen.findByDisplayValue('Robotics Club')).getAttribute('role')).toBe('combobox')
    const panel = await screen.findByRole('tabpanel', { name: 'Clubs (1)' })
    expect(within(panel).getByText('Robot race')).toBeTruthy()
    expect(within(panel).queryByText('Chess night')).toBeNull()
    // The organiser is a club, so the Schools list isn't asked for it.
    expect(searchCalls('school').every((c) => c.args?.p_org === undefined)).toBe(true)
  })

  it('shows both panels side by side on wide screens', async () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    mock.handler = serve({
      club: [post(CLUB, 'Robot race', '2026-10-12T01:00:00Z', '2026-10-12T03:00:00Z')],
      school: [post(SCHOOL, 'FYP talk', '2026-10-30T01:00:00Z', '2026-10-30T03:00:00Z')],
    })
    await renderDashboard()
    expect(within(await screen.findByRole('region', { name: 'Clubs (1)' })).getByText('Robot race')).toBeTruthy()
    expect(within(await screen.findByRole('region', { name: 'Schools (1)' })).getByText('FYP talk')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})
