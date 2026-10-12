import { describe, expect, it } from 'vitest'
import { calendarEventFor } from './calendar.ts'

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
})
