/** How often to look for the new page's h1 while its route renders. */
const POLL_MS = 50

/**
 * After a client-side navigation away from the landing page, move focus to the
 * new page's h1. The clicked link is gone, so focus would otherwise fall back
 * to <body> and screen readers would not hear the new page. The next route may
 * still be rendering (its chunk loads first), so this keeps looking for up to
 * `timeoutMs`. Timers, unlike animation frames, also run in a hidden tab.
 */
export function focusPageHeading(timeoutMs = 5000, doc: Document = document): void {
  const start = Date.now()
  const attempt = () => {
    const h1 = [...doc.querySelectorAll<HTMLElement>('main h1')].find((el) => !el.closest('[data-page="landing"]'))
    if (h1) {
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
      h1.focus()
      return
    }
    if (Date.now() - start < timeoutMs) window.setTimeout(attempt, POLL_MS)
  }
  attempt()
}
