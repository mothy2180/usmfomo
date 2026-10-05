import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../lib/i18n.ts'
import { EventCard } from './EventCard.tsx'
import type { PostCard } from './types.ts'

// lib/db.ts needs the Supabase env; the card only uses the image helpers.
vi.mock('../../lib/db.ts', () => ({
  imageSrc: (path: string | null | undefined) => (path ? `/i/${path}` : undefined),
  onImageError: () => {},
}))

const now = new Date('2026-10-11T04:00:00Z') // Sun 11 Oct, 12:00 MYT

const post = (extra: Partial<PostCard> = {}): PostCard => ({
  id: '906e23b1-9e25-4939-9fb5-3a723547810b',
  org_id: '22222222-2222-4222-8222-222222222222',
  org_name: 'Robotics Club',
  org_slug: 'robotics-club',
  org_type: 'club',
  campus: 'engineering',
  title: 'Line-follower robot competition',
  venue: 'Engineering Campus Main Hall',
  starts_at: '2026-10-11T12:00:00Z',
  ends_at: '2026-10-11T14:00:00Z',
  thumb_path: null,
  cancelled_at: null,
  details_changed_at: null,
  total: 1,
  ...extra,
})

/** Renders inside a throwaway router so <Link> works. */
async function renderInRouter(node: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{node}</> })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/' }),
    createRoute({ getParentRoute: () => rootRoute, path: '/e/$id' }),
    createRoute({ getParentRoute: () => rootRoute, path: '/o/$slug' }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) })
  const view = render(<RouterProvider router={router} />)
  await screen.findByRole('article')
  return view
}

describe('EventCard', () => {
  beforeAll(async () => {
    // The router restores scroll positions; jsdom has no scrollTo.
    window.scrollTo = () => {}
    await i18n.changeLanguage('en')
  })
  afterEach(cleanup)

  it('links the whole card to the event and the organiser to its page', async () => {
    await renderInRouter(<EventCard post={post()} now={now} />)
    const card = screen.getByRole('article')
    const title = within(card).getByRole('link', { name: 'Line-follower robot competition' })
    expect(title.getAttribute('href')).toBe('/e/906e23b1-9e25-4939-9fb5-3a723547810b')
    expect(title.closest('h4')).not.toBeNull()
    const org = within(card).getByRole('link', { name: 'Robotics Club' })
    expect(org.getAttribute('href')).toBe('/o/robotics-club')
    // Exactly two links: no nested anchors.
    expect(within(card).getAllByRole('link')).toHaveLength(2)
  })

  it('shows the MYT time range and venue as text', async () => {
    await renderInRouter(<EventCard post={post()} now={now} />)
    const time = screen.getByText('Sun 11 Oct · 8:00–10:00 PM')
    expect(time.tagName).toBe('TIME')
    expect(time.getAttribute('datetime')).toBe('2026-10-11T12:00:00Z')
    expect(screen.getByText('Engineering Campus Main Hall')).toBeTruthy()
  })

  it('renders club text as text, never as markup', async () => {
    await renderInRouter(<EventCard post={post({ title: '<img src=x onerror=alert(1)>', venue: '<b>Hall</b>' })} now={now} />)
    expect(screen.getByRole('link', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy()
    expect(screen.getByText('<b>Hall</b>')).toBeTruthy()
    expect(document.querySelector('article b, article img[src="x"]')).toBeNull()
  })

  it('uses a lazy, sized, decorative thumbnail when there is a poster', async () => {
    const thumb = '22222222-2222-4222-8222-222222222222/0e933cbb-0166-4b16-8dbd-caaba70c978b-thumb.webp'
    await renderInRouter(<EventCard post={post({ thumb_path: thumb })} now={now} />)
    const img = screen.getByRole('article').querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe(`/i/${thumb}`)
    expect(img?.getAttribute('alt')).toBe('')
    expect(img?.getAttribute('loading')).toBe('lazy')
    expect(img?.getAttribute('decoding')).toBe('async')
    expect(img?.getAttribute('width')).toBe('96')
    expect(img?.getAttribute('height')).toBe('96')
  })

  it('draws a generated cover from the organiser initial when there is no poster', async () => {
    await renderInRouter(<EventCard post={post()} now={now} />)
    const card = screen.getByRole('article')
    expect(card.querySelector('img')).toBeNull()
    const cover = card.querySelector('[aria-hidden="true"]')
    expect(cover?.textContent).toBe('R')
    expect(cover?.className).toMatch(/bg-linear-to-br/)
  })

  it('shows Happening now, Updated and Cancelled badges from the post', async () => {
    await renderInRouter(
      <EventCard post={post({ starts_at: '2026-10-11T03:00:00Z', ends_at: '2026-10-11T05:00:00Z', details_changed_at: '2026-10-10T00:00:00Z' })} now={now} />,
    )
    expect(screen.getByText('Happening now')).toBeTruthy()
    expect(screen.getByText('Updated')).toBeTruthy()
    cleanup()

    await renderInRouter(<EventCard post={post({ cancelled_at: '2026-10-10T00:00:00Z' })} now={now} />)
    expect(screen.getByText('Cancelled')).toBeTruthy()
    expect(screen.queryByText('Happening now')).toBeNull()
  })

  it('says On until <day> for a multi-day event', async () => {
    await renderInRouter(<EventCard post={post({ starts_at: '2026-10-09T01:00:00Z', ends_at: '2026-10-13T09:00:00Z' })} now={now} />)
    expect(screen.getByText('On until Tue 13 Oct')).toBeTruthy()
    expect(screen.queryByText('Happening now')).toBeNull()
  })

  it('follows the language', async () => {
    await i18n.changeLanguage('ms')
    try {
      await renderInRouter(<EventCard post={post({ cancelled_at: '2026-10-10T00:00:00Z' })} now={now} />)
      expect(screen.getByText('Dibatalkan')).toBeTruthy()
      expect(screen.getByText(/Ahd 11 Okt/)).toBeTruthy()
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
