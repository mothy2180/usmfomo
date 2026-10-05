import { describe, expect, it, vi } from 'vitest'
import { calendarEventFor, downloadIcs, icsFileName, REVOKE_AFTER_MS } from './calendar.ts'

const post = {
  id: '9f703b3a-a492-4948-8d6a-3ecb36370c00',
  title: 'Hack Night: build something in 6 hours',
  starts_at: '2026-10-07T21:00:00+00:00',
  ends_at: '2026-10-08T03:00:00+00:00',
  venue: 'Dewan Kuliah A, Main Campus',
  description: 'Bring a laptop.',
}
const url = 'https://usmfomo.pages.dev/e/9f703b3a-a492-4948-8d6a-3ecb36370c00'

describe('calendar', () => {
  it('links the calendar entry back to the event page', () => {
    expect(calendarEventFor(post, url)).toEqual({
      id: post.id,
      title: post.title,
      startsAt: post.starts_at,
      endsAt: post.ends_at,
      venue: post.venue,
      description: `Bring a laptop.\n\n${url}`,
      url,
    })
    expect(calendarEventFor({ ...post, description: null }, url).description).toBe(url)
  })

  it('names the file after the event', () => {
    expect(icsFileName(post.title)).toBe('hack-night-build-something-in-6-hours.ics')
    expect(icsFileName('!!!')).toBe('event.ics')
  })

  it('downloads an .ics Blob through a temporary link and revokes the URL afterwards', async () => {
    const created: Blob[] = []
    const urls = {
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob)
        return 'blob:test/1'
      }),
      revokeObjectURL: vi.fn(),
    }
    let scheduled: { fn: () => void; ms: number } | undefined
    const clicks: HTMLAnchorElement[] = []
    const onClick = (e: MouseEvent) => {
      e.preventDefault() // jsdom can't navigate
      clicks.push(e.currentTarget as HTMLAnchorElement)
    }
    const createElement = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElement(tag)
      if (tag === 'a') el.addEventListener('click', onClick as EventListener)
      return el
    })
    try {
      downloadIcs(calendarEventFor(post, url), {
        urls,
        schedule: (fn, ms) => {
          scheduled = { fn, ms }
        },
        now: new Date('2026-10-05T00:00:00Z'),
      })
    } finally {
      spy.mockRestore()
    }

    expect(clicks).toHaveLength(1)
    expect(clicks[0]?.getAttribute('href')).toBe('blob:test/1')
    expect(clicks[0]?.download).toBe('hack-night-build-something-in-6-hours.ics')
    expect(document.querySelector('a[download]')).toBeNull() // removed again

    expect(created).toHaveLength(1)
    expect(created[0]?.type).toBe('text/calendar;charset=utf-8')
    const text = await created[0]!.text()
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).toContain('SUMMARY:Hack Night: build something in 6 hours')
    expect(text).toContain('DTSTART:20261007T210000Z')

    expect(urls.revokeObjectURL).not.toHaveBeenCalled()
    expect(scheduled?.ms).toBe(REVOKE_AFTER_MS)
    scheduled?.fn()
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:test/1')
  })
})
