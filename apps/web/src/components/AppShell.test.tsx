import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n, { setLanguage } from '../lib/i18n.ts'
import { AppShell } from './AppShell.tsx'

vi.mock('../env.ts', () => ({ CONTACT_URL: '' }))

async function renderShell() {
  const root = createRootRoute({
    component: () => (
      <AppShell>
        <h1>Posting rules</h1>
      </AppShell>
    ),
  })
  const router = createRouter({ routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/' })]), history: createMemoryHistory() })
  const view = render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { name: 'Posting rules' })
  return view
}

describe('AppShell', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
    window.scrollTo = () => {} // the router restores scroll; jsdom has no scrollTo
  })
  afterEach(() => {
    cleanup()
    setLanguage('en')
  })

  it('names its skip link and landmarks in the chosen language', async () => {
    await renderShell()
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#main')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeTruthy()

    act(() => fireEvent.click(screen.getByRole('button', { name: 'BM' })))
    expect(screen.getByRole('link', { name: 'Langkau ke kandungan' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Utama' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Kaki halaman' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'BM' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.lang).toBe('ms')
  })

  it('makes the header sticky only from the lg breakpoint, where it is one short row', async () => {
    const { container } = await renderShell()
    const header = container.querySelector('header')!
    const classes = header.className.split(/\s+/)
    expect(classes).toContain('lg:sticky')
    expect(classes).not.toContain('sticky')
  })

  it('does not clip the focus ring of the EN / BM buttons', async () => {
    await renderShell()
    const group = screen.getByRole('group', { name: 'Language' })
    expect(group.className).not.toMatch(/\boverflow-(hidden|clip)\b/)
    for (const button of [screen.getByRole('button', { name: 'EN' }), screen.getByRole('button', { name: 'BM' })]) {
      // Raised above its neighbour while focused, so the ring isn't painted over.
      expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'focus-visible:z-10']))
    }
  })
})
