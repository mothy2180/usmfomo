import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { LIMITS } from '@usmfomo/shared/config'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../lib/i18n.ts'
import { RulesPage } from './RulesPage.tsx'

vi.mock('../../env.ts', () => ({ CONTACT_URL: 'https://www.instagram.com/usmfomo.admin' }))

function renderRules() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const routeTree = rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: '/rules', component: RulesPage })])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/rules'] }) })
  render(<RouterProvider router={router} />)
}

const items = (heading: string) =>
  within(screen.getByRole('region', { name: heading }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)

describe('RulesPage', () => {
  beforeAll(() => {
    window.scrollTo = () => {}
  })
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage('en')
  })

  it('states the limits the database enforces', async () => {
    await i18n.changeLanguage('en')
    renderRules()
    expect(await screen.findByRole('heading', { level: 1, name: 'Posting rules' })).toBeTruthy()
    expect(document.title).toBe('Posting rules — usmfomo')
    expect(items('Limits')).toEqual([
      `Up to ${LIMITS.livePosts} live posts at a time.`,
      `Up to ${LIMITS.newPostsPer24h} new posts in any 24 hours. Deleting a post doesn't give the slot back.`,
      `Up to ${LIMITS.editsPer24h} edits in any 24 hours.`,
      `An event can last up to ${LIMITS.maxEventDays} days. Posts disappear by themselves when the event ends.`,
      'Posters: JPG, PNG or WebP, up to 10 MB. They are shrunk automatically before upload.',
    ])
  })

  it('covers who may post, what is not allowed, posters, 2FA, moderation and the disclaimer', async () => {
    await i18n.changeLanguage('en')
    renderRules()
    await screen.findByRole('heading', { level: 1, name: 'Posting rules' })
    expect(items('Who can post').join(' ')).toMatch(/Desasiswa committees.*\(MPP\)/)
    expect(items("What's not allowed")).toHaveLength(5)
    expect(items('Poster tips').join(' ')).toMatch(/centre/)
    expect(items('Keep your account safe').join(' ')).toMatch(/Each committee member adds their own phone/)
    expect(screen.getByRole('region', { name: 'Moderation' }).textContent).toMatch(/may hide or remove any post/)
    expect(screen.getByRole('region', { name: 'An unofficial project' }).textContent).toMatch(/not affiliated with/)
  })

  it('links to the admin contact channel, in both languages', async () => {
    await i18n.changeLanguage('en')
    renderRules()
    const link = await screen.findByRole('link', { name: 'message the usmfomo admin' })
    expect(link.getAttribute('href')).toBe('https://www.instagram.com/usmfomo.admin')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    cleanup()

    await i18n.changeLanguage('ms')
    renderRules()
    expect(await screen.findByRole('heading', { level: 1, name: 'Peraturan siaran' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'hantar mesej kepada admin usmfomo' })).toBeTruthy()
    expect(items('Had')[0]).toBe(`Sehingga ${LIMITS.livePosts} siaran aktif pada satu masa.`)
  })
})
