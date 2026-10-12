import type { CalendarEvent } from '@usmfomo/shared/ics'

type CalendarSource = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  venue: string
  description: string | null
}

/** The calendar entry links back to the event page, which always has the
 * latest time, venue and cancellation. */
export function calendarEventFor(post: CalendarSource, pageUrl: string): CalendarEvent {
  return {
    id: post.id,
    title: post.title,
    startsAt: post.starts_at,
    endsAt: post.ends_at,
    venue: post.venue,
    description: [post.description?.trim(), pageUrl].filter(Boolean).join('\n\n'),
    url: pageUrl,
  }
}
