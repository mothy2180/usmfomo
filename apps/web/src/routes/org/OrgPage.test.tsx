import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbCall, DbHandler } from '../../features/public/testDb.ts'
import type { OrgSummary, PostCard } from '../../features/public/types.ts'
import i18n from '../../lib/i18n.ts'
import { OrgPage } from './OrgPage.tsx'

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
const SCHOOL: OrgSummary = { id: '55555555-5555-4555-8555-555555555555', name: 'School of Medical Sciences', slug: 'school-of-medical-sciences', type: 'school', campus: 'health' }

const card: PostCard = {
  id: '0d1f8c7e-34a5-4f43-9b39-111111111111',
  org_id: SCHOOL.id,
  org_name: SCHOOL.name,
  org_slug: SCHOOL.slug,
  org_type: 'school',
  campus: 'health',
  title: 'Public health talk: sleep and exams',
  venue: 'Health Campus Auditorium',
  starts_at: '2026-10-17T14:00:00Z',
  ends_at: '2026-10-17T16:00:00Z',
  thumb_path: null,
  cancelled_at: null,
  details_changed_at: null,
  total: 1,
}

const serve =
  (org: OrgSummary | null, rows: PostCard[]): DbHandler =>
  (call) => {
    if (call.table === 'orgs') return { data: org, error: null }
    if (call.fn === 'search_posts') return { data: rows, error: null }
    if (call.table === 'site_settings') return { data: { public_reads_enabled: true }, error: null }
    throw new Error(`unexpected call: ${JSON.stringify(call)}`)
  }

function renderOrg(slug: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/o/$slug', component: OrgPage }),
    createRoute({ getParentRoute: () => rootRoute, path: '/e/$id', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: () => null }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [`/o/${slug}`] }) })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('OrgPage', () => {
  beforeAll(async () => {
    window.scrollTo = () => {}
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

  it("lists the organiser's upcoming events through search_posts", async () => {
    mock.handler = serve(SCHOOL, [card])
    renderOrg(SCHOOL.slug)
    expect(await screen.findByRole('heading', { level: 1, name: 'School of Medical Sciences' })).toBeTruthy()
    expect(document.title).toBe('School of Medical Sciences — usmfomo')
    expect(screen.getByText('School · Health campus')).toBeTruthy()

    const events = await screen.findByRole('region', { name: 'Upcoming events (1)' })
    expect(within(events).getByRole('link', { name: card.title }).getAttribute('href')).toBe(`/e/${card.id}`)
    const search = mock.calls.find((c) => c.fn === 'search_posts')
    expect(search?.args).toEqual({ p_type: 'school', p_org: SCHOOL.id, p_limit: 20, p_offset: 0 })
    expect(mock.calls.find((c) => c.table === 'orgs')?.chain).toContainEqual(['eq', ['slug', SCHOOL.slug]])
  })

  it('says so when the organiser has nothing coming up', async () => {
    mock.handler = serve(SCHOOL, [])
    renderOrg(SCHOOL.slug)
    expect(await screen.findByText('No upcoming events from School of Medical Sciences right now.')).toBeTruthy()
  })

  it('shows a not-found state for an unknown or inactive organiser', async () => {
    mock.handler = serve(null, [])
    renderOrg('no-such-org')
    expect(await screen.findByRole('heading', { level: 1, name: "We couldn't find this organiser." })).toBeTruthy()
    expect(mock.calls.some((c) => c.fn === 'search_posts')).toBe(false)
  })

  it('does not ask the database about a slug that cannot exist', async () => {
    mock.handler = serve(SCHOOL, [card])
    renderOrg('Not_A_Slug!')
    expect(await screen.findByRole('heading', { level: 1, name: "We couldn't find this organiser." })).toBeTruthy()
    expect(mock.calls).toHaveLength(0)
  })
})
