// "Add to calendar" (RFC 5545) built in the browser. Club-written text is
// escaped and folded so it can never inject extra iCalendar properties.

export type CalendarEvent = {
  id: string
  title: string
  startsAt: string
  endsAt: string
  venue: string
  description?: string | null
  url?: string | null
}

const stripControls = (s: string) => s.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeIcsText(value: string): string {
  return stripControls(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Fold content lines at 75 octets (UTF-8), continuation lines start with a space. */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const limit = out.length === 0 ? 75 : 74 // continuation lines carry a leading space
    if (bytes + n > limit) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += n
  }
  out.push(current)
  return out.join('\r\n ')
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function buildIcs(ev: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//usmfomo//events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.id.replace(/[^0-9a-f-]/gi, '')}@usmfomo.pages.dev`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(ev.startsAt)}`,
    `DTEND:${icsDate(ev.endsAt)}`,
    `SUMMARY:${escapeIcsText(ev.title)}`,
    `LOCATION:${escapeIcsText(ev.venue)}`,
  ]
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`)
  if (ev.url && /^https:\/\/[^\s]+$/.test(ev.url)) lines.push(`URL:${escapeIcsText(ev.url)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: stripControls(ev.title),
    dates: `${icsDate(ev.startsAt)}/${icsDate(ev.endsAt)}`,
    location: stripControls(ev.venue),
    details: stripControls(ev.description ?? ''),
    ctz: 'Asia/Kuala_Lumpur',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
