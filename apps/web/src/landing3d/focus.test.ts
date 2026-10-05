import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusPageHeading } from './focus.ts'

describe('focusPageHeading', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('focuses the new page’s h1 at once when it is there', () => {
    document.body.innerHTML = '<main><h1>What’s on</h1></main>'
    focusPageHeading()
    const h1 = document.querySelector('h1')!
    expect(document.activeElement).toBe(h1)
    expect(h1.getAttribute('tabindex')).toBe('-1')
  })

  it('waits for the next route to render, ignoring the landing page’s own h1', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div data-page="landing"><main><h1>usmfomo</h1></main></div>'
    focusPageHeading()
    expect(document.activeElement).toBe(document.body)
    vi.advanceTimersByTime(200)
    document.body.innerHTML = '<main><h1 tabindex="0">What’s on</h1></main>'
    vi.advanceTimersByTime(60)
    const h1 = document.querySelector('h1')!
    expect(document.activeElement).toBe(h1)
    expect(h1.getAttribute('tabindex')).toBe('0') // an existing tabindex is kept
  })

  it('gives up after the timeout', () => {
    vi.useFakeTimers()
    focusPageHeading(500)
    vi.advanceTimersByTime(600)
    document.body.innerHTML = '<main><h1>Late</h1></main>'
    vi.advanceTimersByTime(1000)
    expect(document.activeElement).toBe(document.body)
  })
})
