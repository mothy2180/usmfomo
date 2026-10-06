import type { AnyRouter } from '@tanstack/react-router'

/** How often to look for the new page's h1 while it renders. */
const POLL_MS = 50
/** How long to keep looking, and to follow a heading that is replaced. */
const WATCH_MS = 10_000

/**
 * Moves focus to the new page's h1 after a client-side navigation. The link
 * that was used went away with the old page, so focus would otherwise fall
 * back to <body> and screen readers would not hear the new page.
 *
 * The h1 can come late (the page is still loading its data) or be replaced (a
 * loading heading by the real one), so this keeps watching for `watchMs`. It
 * never takes focus from an element that has it: once the page or the visitor
 * has put focus somewhere, it stops. Timers, unlike animation frames, also run
 * in a hidden tab. Returns a function that stops watching.
 */
export function focusPageHeading(watchMs = WATCH_MS, doc: Document = document): () => void {
  const start = Date.now()
  let heading: HTMLElement | null = null
  let timer: number | undefined
  const check = () => {
    timer = undefined
    const active = doc.activeElement
    const lost = !active || active === doc.body
    if (heading && active !== heading) {
      // Focus left the heading: follow only a heading that was removed.
      if (!lost || heading.isConnected) return
      heading = null
    } else if (!heading && !lost) {
      return
    }
    if (!heading) {
      const h1 = doc.querySelector<HTMLElement>('main h1')
      if (h1) {
        if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
        // Scrolling is the router's job (top of a new page, restored on Back).
        h1.focus({ preventScroll: true })
        heading = h1
      }
    }
    if (Date.now() - start < watchMs) timer = window.setTimeout(check, POLL_MS)
  }
  check()
  return () => window.clearTimeout(timer)
}

/**
 * The one place that moves focus on navigation: once a new path has rendered,
 * focus goes to its h1. Not on the first load (the browser starts at the top)
 * and not when only the search params change (the dashboard filters keep
 * focus where it is). Returns a function that unsubscribes.
 */
export function focusHeadingOnPathChange(router: Pick<AnyRouter, 'subscribe'>): () => void {
  let stop = () => {}
  const unsubscribe = router.subscribe('onRendered', ({ fromLocation, toLocation }) => {
    if (!fromLocation || fromLocation.pathname === toLocation.pathname) return
    stop()
    stop = focusPageHeading()
  })
  return () => {
    unsubscribe()
    stop()
  }
}
