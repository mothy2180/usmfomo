import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { focusHeadingOnPathChange, focusPageHeading } from './pageFocus.ts'

describe('focusPageHeading', () => {
  let stop = () => {}
  afterEach(() => {
    stop()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('focuses the new page’s h1 at once when it is there', () => {
    document.body.innerHTML = '<main><h1>What’s on</h1></main>'
    stop = focusPageHeading()
    const h1 = document.querySelector('h1')!
    expect(document.activeElement).toBe(h1)
    expect(h1.getAttribute('tabindex')).toBe('-1')
  })

  it('waits for the h1 to render, keeping an existing tabindex', () => {
    vi.useFakeTimers()
    stop = focusPageHeading()
    expect(document.activeElement).toBe(document.body)
    vi.advanceTimersByTime(200)
    document.body.innerHTML = '<main><h1 tabindex="0">What’s on</h1></main>'
    vi.advanceTimersByTime(60)
    const h1 = document.querySelector('h1')!
    expect(document.activeElement).toBe(h1)
    expect(h1.getAttribute('tabindex')).toBe('0')
  })

  it('follows a loading heading that is replaced by the real one', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<main><h1 class="sr-only">Event</h1></main>'
    stop = focusPageHeading()
    expect(document.activeElement?.textContent).toBe('Event')
    // The data arrives: the loading heading goes, and focus with it.
    document.querySelector('main')!.innerHTML = '<article><h1>Hack Night</h1></article>'
    expect(document.activeElement).toBe(document.body)
    vi.advanceTimersByTime(60)
    expect(document.activeElement?.textContent).toBe('Hack Night')
  })

  it('never takes focus from an element that has it', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<main><input aria-label="Username" /></main>'
    const input = document.querySelector('input')!
    input.focus()
    stop = focusPageHeading()
    document.querySelector('main')!.insertAdjacentHTML('afterbegin', '<h1>Sign in</h1>')
    vi.advanceTimersByTime(200)
    expect(document.activeElement).toBe(input)
  })

  it('stops once the visitor moves on, even if the heading is replaced later', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<main><h1>Loading</h1><a href="/rules">Rules</a></main>'
    stop = focusPageHeading()
    document.querySelector('a')!.focus()
    vi.advanceTimersByTime(60)
    document.querySelector('main')!.innerHTML = '<h1>Loaded</h1>'
    vi.advanceTimersByTime(200)
    expect(document.activeElement).toBe(document.body)
  })

  it('gives up after the watch time, or when stopped', () => {
    vi.useFakeTimers()
    stop = focusPageHeading(500)
    vi.advanceTimersByTime(600)
    document.body.innerHTML = '<main><h1>Late</h1></main>'
    vi.advanceTimersByTime(1000)
    expect(document.activeElement).toBe(document.body)

    document.body.innerHTML = ''
    focusPageHeading()()
    document.body.innerHTML = '<main><h1>Late</h1></main>'
    vi.advanceTimersByTime(1000)
    expect(document.activeElement).toBe(document.body)
  })
})

function Page({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  )
}

/** Shows a loading heading first, then the real one (like the event page). */
function SlowPage() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 120)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <main>
      {ready ? (
        <article>
          <h1>Hack Night</h1>
        </article>
      ) : (
        <h1 className="sr-only">Event</h1>
      )}
    </main>
  )
}

describe('focusHeadingOnPathChange', () => {
  let off = () => {}
  // Names of the elements that received focus, in order.
  const focused: string[] = []
  const record = (e: FocusEvent) => {
    const el = e.target as HTMLElement
    focused.push(el.getAttribute('aria-label') ?? el.textContent ?? '')
  }

  beforeAll(() => {
    // jsdom has no scrolling; the router's scroll restoration calls it.
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  })
  afterEach(() => {
    off()
    cleanup()
    document.removeEventListener('focusin', record)
    focused.length = 0
  })

  function renderAt(path: string) {
    const root = createRootRoute({ component: () => <Outlet /> })
    const routeTree = root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/dashboard',
        validateSearch: (search: Record<string, unknown>) => (typeof search.q === 'string' ? { q: search.q } : {}),
        component: () => (
          <Page title="What’s on">
            <input aria-label="Search" />
            <Link to="/rules">Posting rules</Link>
          </Page>
        ),
      }),
      createRoute({ getParentRoute: () => root, path: '/rules', component: () => <Page title="Posting rules" /> }),
      createRoute({ getParentRoute: () => root, path: '/e/$id', component: SlowPage }),
    ])
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
    off = focusHeadingOnPathChange(router)
    document.addEventListener('focusin', record)
    render(<RouterProvider router={router} />)
    return router
  }

  it('leaves the first load alone', async () => {
    renderAt('/dashboard')
    await screen.findByRole('heading', { name: 'What’s on' })
    await act(() => new Promise((r) => setTimeout(r, 100)))
    expect(document.activeElement).toBe(document.body)
  })

  it('focuses the new page’s heading exactly once after a path change, and again on Back', async () => {
    const router = renderAt('/dashboard')
    fireEvent.click(await screen.findByRole('link', { name: 'Posting rules' }))
    const heading = await screen.findByRole('heading', { name: 'Posting rules' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    await act(() => new Promise((r) => setTimeout(r, 150)))
    expect(focused).toEqual(['Posting rules'])

    act(() => router.history.back())
    const back = await screen.findByRole('heading', { name: 'What’s on' })
    await waitFor(() => expect(document.activeElement).toBe(back))
  })

  it('leaves focus alone when only the search params change', async () => {
    const router = renderAt('/dashboard')
    await screen.findByRole('heading', { name: 'What’s on' })
    // Nothing has focus (say the button used went away): no jump to the heading.
    await act(() => router.navigate({ to: '/dashboard', search: { q: 'robot' }, replace: true }))
    expect(router.state.location.search).toEqual({ q: 'robot' })
    await act(() => new Promise((r) => setTimeout(r, 100)))
    expect(document.activeElement).toBe(document.body)
    // A filter field keeps its focus.
    const search = screen.getByRole('textbox', { name: 'Search' })
    act(() => search.focus())
    await act(() => router.navigate({ to: '/dashboard', search: { q: 'robots' }, replace: true }))
    await act(() => new Promise((r) => setTimeout(r, 100)))
    expect(document.activeElement).toBe(search)
    expect(focused).toEqual(['Search'])
  })

  it('ends on the real heading of a page that shows a loading one first', async () => {
    const router = renderAt('/dashboard')
    await screen.findByRole('heading', { name: 'What’s on' })
    await act(() => router.navigate({ to: '/e/$id', params: { id: 'x' } }))
    const heading = await screen.findByRole('heading', { name: 'Hack Night' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })
})
