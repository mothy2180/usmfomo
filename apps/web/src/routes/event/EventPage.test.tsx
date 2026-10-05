import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbCall, DbHandler } from '../../features/public/testDb.ts'
import type { EventDetail } from '../../features/public/types.ts'
import i18n from '../../lib/i18n.ts'
import { EventPage } from './EventPage.tsx'

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
const ID = '906e23b1-9e25-4939-9fb5-3a723547810b'
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TITLE = 'Hack Night: build something in 6 hours'
const GONE = 'This event has ended or was removed by its organiser.'

const event = (extra: Partial<EventDetail> = {}): EventDetail => ({
  id: ID,
  org_id: ORG_ID,
  campus: 'main',
  title: TITLE,
  venue: 'Dewan Kuliah A',
  description: 'Bring a laptop.\nSnacks provided.',
  link_url: 'https://forms.gle/example',
  starts_at: '2026-10-12T12:00:00Z',
  ends_at: '2026-10-12T15:00:00Z',
  poster_path: `${ORG_ID}/0e933cbb-0166-4b16-8dbd-caaba70c978b.webp`,
  thumb_path: `${ORG_ID}/0e933cbb-0166-4b16-8dbd-caaba70c978b-thumb.webp`,
  cancelled_at: null,
  details_changed_at: null,
  updated_at: '2026-10-05T02:19:37Z',
  org: { id: ORG_ID, name: 'Computer Science Society', slug: 'computer-science-society', type: 'club' },
  ...extra,
})

/** posts -> `row` (null = no visible post); site_settings -> reads on. */
const serve =
  (row: EventDetail | null): DbHandler =>
  (call) => {
    if (call.table === 'posts') return { data: row, error: null }
    if (call.table === 'site_settings') return { data: { public_reads_enabled: true }, error: null }
    throw new Error(`unexpected call: ${JSON.stringify(call)}`)
  }

function renderEvent(id: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/e/$id', component: EventPage }),
    createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/o/$slug', component: () => null }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [`/e/${id}`] }) })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('EventPage', () => {
  beforeAll(async () => {
    window.scrollTo = () => {} // the router restores scroll; jsdom has no scrollTo
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mock.calls.length = 0
    mock.handler = null
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('treats an id that cannot exist as gone, without asking the database', async () => {
    mock.handler = serve(event())
    renderEvent('not-a-uuid')
    expect(await screen.findByRole('heading', { level: 1, name: GONE })).toBeTruthy()
    expect(screen.getByRole('link', { name: "See what's on now" }).getAttribute('href')).toBe('/dashboard')
    expect(document.title).toBe('Event ended or removed — usmfomo')
    expect(mock.calls).toHaveLength(0)
  })

  it('shows one message for an ended, deleted or hidden post', async () => {
    mock.handler = serve(null)
    renderEvent(ID)
    expect(await screen.findByRole('heading', { level: 1, name: GONE })).toBeTruthy()
    const [post] = mock.calls
    expect(post?.table).toBe('posts')
    expect(post?.chain[0]).toEqual([
      'select',
      ['id,org_id,campus,title,venue,description,link_url,starts_at,ends_at,poster_path,thumb_path,cancelled_at,details_changed_at,updated_at,org:orgs(id,name,slug,type)'],
    ])
    expect(post?.chain[1]).toEqual(['eq', ['id', ID]])
    expect(post?.chain.some(([method]) => method === 'maybeSingle')).toBe(true)
  })

  it('shows the poster, time in MYT, venue, organiser, description and links', async () => {
    mock.handler = serve(event())
    renderEvent(ID)
    expect(await screen.findByRole('heading', { level: 1, name: TITLE })).toBeTruthy()
    expect(document.title).toBe(`${TITLE} — usmfomo`)

    const poster = screen.getByRole('img', { name: `Poster: ${TITLE}` })
    expect(poster.getAttribute('src')).toBe(`/i/${event().poster_path}`)
    expect(screen.getByText('Mon 12 Oct · 8:00–11:00 PM').tagName).toBe('TIME')
    expect(screen.getByText('Times are Malaysia time (MYT)')).toBeTruthy()
    expect(screen.getByText('Dewan Kuliah A')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Computer Science Society' }).getAttribute('href')).toBe('/o/computer-science-society')

    // Club text stays text; CSS (whitespace-pre-line) keeps its line breaks.
    const about = screen.getByRole('region', { name: 'About this event' })
    const description = within(about).getByText(/Bring a laptop\./)
    expect(description.textContent).toBe('Bring a laptop.\nSnacks provided.')
    expect(description.className).toContain('whitespace-pre-line')

    const registration = screen.getByRole('link', { name: /Registration and details/ })
    expect(registration.getAttribute('href')).toBe('https://forms.gle/example')
    expect(registration.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc')
    expect(within(registration).getByText('(forms.gle)')).toBeTruthy()

    expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeTruthy()
    const google = screen.getByRole('link', { name: /Google Calendar/ })
    expect(google.getAttribute('href')).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/)
    expect(google.getAttribute('target')).toBe('_blank')
    expect(google.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
  })

  it('falls back to a generated cover when there is no poster', async () => {
    mock.handler = serve(event({ poster_path: null, thumb_path: null }))
    renderEvent(ID)
    await screen.findByRole('heading', { level: 1, name: TITLE })
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.querySelector('main [aria-hidden="true"].bg-linear-to-br')?.textContent).toBe('C')
  })

  it('says a cancelled event is cancelled and offers no calendar entry', async () => {
    mock.handler = serve(event({ cancelled_at: '2026-10-10T00:00:00Z' }))
    renderEvent(ID)
    await screen.findByRole('heading', { level: 1, name: TITLE })
    expect(screen.getByText('Cancelled')).toBeTruthy()
    expect(screen.getByText('This event has been cancelled by its organiser.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
  })

  it('treats a post that has already ended as gone', async () => {
    mock.handler = serve(event({ starts_at: '2026-10-11T01:00:00Z', ends_at: '2026-10-11T03:00:00Z' }))
    renderEvent(ID)
    expect(await screen.findByRole('heading', { level: 1, name: GONE })).toBeTruthy()
  })
})
