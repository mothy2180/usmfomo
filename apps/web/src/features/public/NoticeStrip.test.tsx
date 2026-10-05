import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../lib/i18n.ts'
import { dismissKey } from './noticeStorage.ts'
import { NoticeStrip } from './NoticeStrip.tsx'
import type { Notice } from './types.ts'

const now = new Date('2026-10-11T04:00:00Z')

const notice = (n: number, extra: Partial<Notice> = {}): Notice => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Notice ${n}`,
  body: `Body ${n}`,
  link_url: null,
  starts_at: '2026-10-10T00:00:00Z',
  ends_at: '2026-10-20T00:00:00Z',
  updated_at: `2026-10-0${n}T00:00:00Z`,
  ...extra,
})

describe('NoticeStrip', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => window.localStorage.clear())
  afterEach(cleanup)

  it('renders nothing when no notice is live', () => {
    const { container } = render(
      <NoticeStrip
        notices={[notice(1, { ends_at: '2026-10-11T03:00:00Z' }), notice(2, { starts_at: '2026-10-12T00:00:00Z' })]}
        now={now}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows two notices and keeps the rest behind "More notices (n)"', () => {
    render(<NoticeStrip notices={[notice(1), notice(2), notice(3), notice(4)]} now={now} />)
    expect(screen.getByRole('heading', { name: 'Notices' })).toBeTruthy()
    const more = screen.getByRole('button', { name: 'More notices (2)' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Notice 1')).toBeTruthy()
    expect(screen.getByText('Notice 2')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Notice 3' })).toBeNull() // inside a hidden list

    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Notice 3' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Notice 4' })).toBeTruthy()
  })

  it('remembers a dismissal per notice version', () => {
    const first = notice(1)
    render(<NoticeStrip notices={[first, notice(2)]} now={now} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice: Notice 1' }))
    expect(screen.queryByText('Notice 1')).toBeNull()
    expect(window.localStorage.getItem(dismissKey(first))).toBe('1')
    // Focus moves to the strip heading instead of being lost.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Notices' }))

    // Still hidden on the next visit...
    cleanup()
    render(<NoticeStrip notices={[first, notice(2)]} now={now} />)
    expect(screen.queryByText('Notice 1')).toBeNull()
    // ...until the owner edits it.
    cleanup()
    render(<NoticeStrip notices={[{ ...first, updated_at: '2026-10-10T09:00:00Z' }]} now={now} />)
    expect(screen.getByText('Notice 1')).toBeTruthy()
  })

  it('hides the strip after the last dismissal and hands focus back', () => {
    const onAllDismissed = vi.fn()
    const { container } = render(<NoticeStrip notices={[notice(1)]} now={now} onAllDismissed={onAllDismissed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice: Notice 1' }))
    expect(container.innerHTML).toBe('')
    expect(onAllDismissed).toHaveBeenCalledOnce()
  })

  it('still dismisses when storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError')
    })
    try {
      render(<NoticeStrip notices={[notice(1), notice(2)]} now={now} />)
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice: Notice 1' }))
      expect(screen.queryByText('Notice 1')).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('shows the link hostname and keeps body text as text', () => {
    render(
      <NoticeStrip
        notices={[notice(1, { body: '<script>alert(1)</script>\nSecond line', link_url: 'https://forms.gle/abc' })]}
        now={now}
      />,
    )
    expect(screen.getByRole('link', { name: /More info/ }).getAttribute('href')).toBe('https://forms.gle/abc')
    expect(screen.getByText('(forms.gle)')).toBeTruthy()
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy()
    expect(document.querySelector('section script')).toBeNull()
  })
})
