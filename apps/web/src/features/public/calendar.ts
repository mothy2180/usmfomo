import { buildIcs, type CalendarEvent } from '@usmfomo/shared/ics'
import { slugify } from '@usmfomo/shared/schemas'

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

export function icsFileName(title: string): string {
  return `${slugify(title) || 'event'}.ics`
}

/** How long the object URL stays valid after the click (as FileSaver.js does:
 * some browsers read the Blob only after the click handler returns). */
export const REVOKE_AFTER_MS = 40_000

type DownloadDeps = {
  doc?: Document
  urls?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
  schedule?: (fn: () => void, ms: number) => unknown
  now?: Date
}

/** "Add to calendar": buildIcs -> Blob -> object URL -> temporary download
 * link, clicked once; the URL is revoked shortly after. */
export function downloadIcs(ev: CalendarEvent, deps: DownloadDeps = {}): void {
  const doc = deps.doc ?? document
  const urls = deps.urls ?? URL
  const schedule = deps.schedule ?? ((fn, ms) => window.setTimeout(fn, ms))
  const blob = new Blob([buildIcs(ev, deps.now)], { type: 'text/calendar;charset=utf-8' })
  const href = urls.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = href
  a.download = icsFileName(ev.title)
  a.hidden = true
  doc.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    schedule(() => urls.revokeObjectURL(href), REVOKE_AFTER_MS)
  }
}
