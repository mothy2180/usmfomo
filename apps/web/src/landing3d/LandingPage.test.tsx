import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusHeadingOnPathChange } from '../components/pageFocus.ts'
import i18n, { setLanguage } from '../lib/i18n.ts'
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

// Texts of the elements that received focus, in order.
const focused: string[] = []
const recordFocus = (e: FocusEvent) => focused.push((e.target as HTMLElement).textContent ?? '')
let stopFocus = () => {}

function renderAt(path = '/') {
  const root = createRootRoute({ component: () => <Outlet /> })
  const landing = createRoute({ getParentRoute: () => root, path: '/', component: LandingPage })
  const page = (title: string) => () => (
    <main>
      <h1>{title}</h1>
    </main>
  )
  const dashboard = createRoute({ getParentRoute: () => root, path: '/dashboard', component: page('What’s on') })
  const login = createRoute({ getParentRoute: () => root, path: '/login', component: page('Club & school login') })
  const router = createRouter({
    routeTree: root.addChildren([landing, dashboard, login]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  // The app router's focus handling (router.tsx), the only one there is.
  stopFocus = focusHeadingOnPathChange(router)
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
    focused.length = 0
    document.addEventListener('focusin', recordFocus)
  })
  afterEach(() => {
    stopFocus()
    cleanup()
    document.removeEventListener('focusin', recordFocus)
    setLanguage('en')
  })

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
    // Focus moved once: the page does not move it a second time.
    await act(() => new Promise((r) => setTimeout(r, 150)))
    expect(focused).toEqual(['What’s on'])
  })

  it('opens Login in the app and focuses its heading once', async () => {
    const router = renderAt()
    const login = await screen.findByRole('link', { name: /Login/ })
    expect(fireEvent.click(login)).toBe(false) // default prevented: no page load
    const heading = await screen.findByRole('heading', { name: 'Club & school login' })
    expect(router.state.location.pathname).toBe('/login')
    await waitFor(() => expect(document.activeElement).toBe(heading))
    await act(() => new Promise((r) => setTimeout(r, 150)))
    expect(focused).toEqual(['Club & school login'])
  })

  it('switches the landing page to BM, title included', async () => {
    renderAt()
    const bm = await screen.findByRole('button', { name: 'BM' })
    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.title).toBe("usmfomo — what's on at USM")
    fireEvent.click(bm)
    expect(await screen.findByText('Lihat apa yang berlaku di sekitar USM')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'BM' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('link', { name: /Log masuk/ })).toBeTruthy()
    await waitFor(() => expect(document.title).toBe('usmfomo — apa yang berlaku di USM'))
    expect(document.documentElement.lang).toBe('ms')
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
