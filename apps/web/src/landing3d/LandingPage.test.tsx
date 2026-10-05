import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n.ts'
import { LandingPage } from '../routes/landing/LandingPage.tsx'
import { LITE_KEY, MOTION_KEY } from './prefs.ts'
import { WARP_MS, type SceneProps } from './types.ts'

// The lazy scene and the WebGL2 probe are replaced: jsdom has no WebGL. The
// fake scene reports itself ready with a fake warp().
const fake = vi.hoisted(() => ({
  webgl2: false,
  imported: 0,
  warp: vi.fn((_ms: number) => Promise.resolve()),
}))

vi.mock('./gating.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gating.ts')>()),
  hasWebGL2: () => fake.webgl2,
}))

vi.mock('./LandingScene.tsx', async () => {
  fake.imported++
  const { useEffect } = await import('react')
  return {
    default: function FakeScene({ onReady }: SceneProps) {
      useEffect(() => {
        onReady({ warp: fake.warp })
        return () => onReady(null)
      }, [onReady])
      return <div data-testid="scene" />
    },
  }
})

function renderAt(path = '/') {
  const root = createRootRoute({ component: () => <Outlet /> })
  const landing = createRoute({ getParentRoute: () => root, path: '/', component: LandingPage })
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    component: () => (
      <main>
        <h1>What’s on</h1>
      </main>
    ),
  })
  const router = createRouter({ routeTree: root.addChildren([landing, dashboard]), history: createMemoryHistory({ initialEntries: [path] }) })
  render(<RouterProvider router={router} />)
  return router
}

describe('LandingPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
    // jsdom has no scrolling; the router's scroll restoration calls it.
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  })
  beforeEach(() => {
    window.localStorage.clear()
    fake.webgl2 = false
    fake.imported = 0
    fake.warp.mockClear()
  })
  afterEach(cleanup)

  it('keeps the placeholder and never loads the 3D chunk without WebGL2', async () => {
    renderAt()
    expect(await screen.findByRole('link', { name: "I'm FOMO" })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pause motion' }).getAttribute('aria-pressed')).toBe('false')
    // Give the idle callback and the probe time to run.
    await act(() => new Promise((r) => setTimeout(r, 400)))
    expect(screen.queryByTestId('scene')).toBeNull()
    expect(fake.imported).toBe(0)
  })

  it('loads the scene when allowed, and lite mode unloads it (remembered)', async () => {
    fake.webgl2 = true
    renderAt()
    expect(await screen.findByTestId('scene', {}, { timeout: 2000 })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Lite mode' }))
    expect(window.localStorage.getItem(LITE_KEY)).toBe('on')
    expect(screen.getByRole('button', { name: 'Lite mode' }).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(screen.queryByTestId('scene')).toBeNull())
  })

  it('does not load anything for a page that starts paused', async () => {
    fake.webgl2 = true
    window.localStorage.setItem(MOTION_KEY, 'paused')
    renderAt()
    const pause = await screen.findByRole('button', { name: 'Pause motion' })
    expect(pause.getAttribute('aria-pressed')).toBe('true')
    await act(() => new Promise((r) => setTimeout(r, 400)))
    expect(screen.queryByTestId('scene')).toBeNull()
    // Pressing it again plays (and loads) the scene.
    fireEvent.click(pause)
    expect(window.localStorage.getItem(MOTION_KEY)).toBe('playing')
    expect(await screen.findByTestId('scene', {}, { timeout: 2000 })).toBeTruthy()
  })

  it('plays the warp, then navigates and focuses the dashboard heading', async () => {
    fake.webgl2 = true
    const router = renderAt()
    await screen.findByTestId('scene', {}, { timeout: 2000 })
    const cta = screen.getByRole('link', { name: "I'm FOMO" })
    expect(fireEvent.click(cta)).toBe(false) // default prevented
    expect(fake.warp).toHaveBeenCalledOnce()
    expect(fake.warp.mock.calls[0]?.[0]).toBe(WARP_MS)
    const heading = await screen.findByRole('heading', { name: 'What’s on' })
    expect(router.state.location.pathname).toBe('/dashboard')
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('skips the warp while paused but still navigates', async () => {
    fake.webgl2 = true
    renderAt()
    await screen.findByTestId('scene', {}, { timeout: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Pause motion' }))
    // A running scene stays mounted (frozen) when paused.
    expect(screen.getByTestId('scene')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: "I'm FOMO" }))
    expect(fake.warp).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'What’s on' })).toBeTruthy()
  })

  it('leaves modifier clicks to the browser (new tab)', async () => {
    fake.webgl2 = true
    const router = renderAt()
    await screen.findByTestId('scene', {}, { timeout: 2000 })
    const cta = screen.getByRole('link', { name: "I'm FOMO" })
    // Runs after React's handler: records whether the page took over the
    // click, then stops jsdom from trying to follow the link.
    const prevented: boolean[] = []
    const record = (e: Event) => {
      prevented.push(e.defaultPrevented)
      e.preventDefault()
    }
    window.addEventListener('click', record)
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) fireEvent.click(cta, mod)
    window.removeEventListener('click', record)
    expect(prevented).toEqual([false, false, false, false])
    expect(fake.warp).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/')
  })
})
