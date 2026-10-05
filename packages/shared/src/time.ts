// Malaysia time (MYT, UTC+8, no daylight saving) everywhere, whatever the
// device's time zone. Storage is UTC (timestamptz); input and display are MYT.

export const MYT_TZ = 'Asia/Kuala_Lumpur'
const MYT_OFFSET = '+08:00'
const DAY_MS = 24 * 60 * 60 * 1000

export type Locale = 'en' | 'ms'
const intlLocale = (l: Locale) => (l === 'ms' ? 'ms-MY' : 'en-MY')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** "2026-10-11" + "20:00" (both MYT) -> ISO instant in UTC. */
export function mytInputToIso(date: string, time: string): string {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) {
    throw new RangeError('invalid date or time input')
  }
  const d = new Date(`${date}T${time}:00${MYT_OFFSET}`)
  if (Number.isNaN(d.getTime())) throw new RangeError('invalid date')
  // Reject impossible calendar dates such as 2026-02-31 (Date would roll over).
  if (isoToMytInput(d.toISOString()).date !== date) throw new RangeError('invalid date')
  return d.toISOString()
}

/** ISO instant -> { date: "YYYY-MM-DD", time: "HH:MM" } in MYT. */
export function isoToMytInput(iso: string): { date: string; time: string } {
  const parts = partsOf(new Date(iso), {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }, 'en')
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
  }
}

/** Calendar day in MYT as "YYYY-MM-DD". */
export function mytDayKey(d: Date | string): string {
  return isoToMytInput(typeof d === 'string' ? d : d.toISOString()).date
}

function partsOf(d: Date, opts: Intl.DateTimeFormatOptions, locale: Locale): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat(intlLocale(locale), { ...opts, timeZone: MYT_TZ }).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = p.value
  }
  return out
}

function dayLabel(d: Date, locale: Locale): string {
  const p = partsOf(d, { weekday: 'short', day: 'numeric', month: 'short' }, locale)
  return `${p.weekday} ${p.day} ${p.month}`
}

function timeLabel(d: Date, locale: Locale, withPeriod = true): string {
  const p = partsOf(d, { hour: 'numeric', minute: '2-digit', hour12: true }, locale)
  const t = `${p.hour}:${p.minute}`
  return withPeriod && p.dayPeriod ? `${t} ${p.dayPeriod.toUpperCase()}` : t
}

function sameDayPeriod(a: Date, b: Date, locale: Locale): boolean {
  const pa = partsOf(a, { hour: 'numeric', hour12: true }, locale).dayPeriod
  const pb = partsOf(b, { hour: 'numeric', hour12: true }, locale).dayPeriod
  return pa === pb
}

/** True when the event runs for more than 24 hours. */
export function isLongEvent(startIso: string, endIso: string): boolean {
  return new Date(endIso).getTime() - new Date(startIso).getTime() > DAY_MS
}

/**
 * Human range in MYT:
 *   same day  "Sat 11 Oct · 8:00–10:00 PM"
 *   overnight "Sat 11 Oct 10:00 PM – Sun 12 Oct 2:00 AM"
 *   long      "Mon 6 – Fri 10 Oct" (or "Fri 30 Oct – Mon 2 Nov")
 */
export function formatEventRange(startIso: string, endIso: string, locale: Locale = 'en'): string {
  const s = new Date(startIso)
  const e = new Date(endIso)
  if (isLongEvent(startIso, endIso)) {
    const ps = partsOf(s, { weekday: 'short', day: 'numeric', month: 'short' }, locale)
    const pe = partsOf(e, { weekday: 'short', day: 'numeric', month: 'short' }, locale)
    return ps.month === pe.month
      ? `${ps.weekday} ${ps.day} – ${pe.weekday} ${pe.day} ${pe.month}`
      : `${ps.weekday} ${ps.day} ${ps.month} – ${pe.weekday} ${pe.day} ${pe.month}`
  }
  if (mytDayKey(s) === mytDayKey(e)) {
    const startT = sameDayPeriod(s, e, locale) ? timeLabel(s, locale, false) : timeLabel(s, locale)
    return `${dayLabel(s, locale)} · ${startT}–${timeLabel(e, locale)}`
  }
  return `${dayLabel(s, locale)} ${timeLabel(s, locale)} – ${dayLabel(e, locale)} ${timeLabel(e, locale)}`
}

/** "Fri 10 Oct" in MYT (used for "On until ..."). */
export function formatDay(iso: string, locale: Locale = 'en'): string {
  return dayLabel(new Date(iso), locale)
}

export type EventGroup = 'now' | 'today' | 'tomorrow' | 'week' | 'later'

/** Dashboard grouping, by MYT calendar day relative to `now`. */
export function eventGroup(startIso: string, endIso: string, now: Date = new Date()): EventGroup {
  const s = new Date(startIso)
  const e = new Date(endIso)
  if (s <= now && e > now) return 'now'
  const today = mytDayKey(now)
  const day = mytDayKey(s)
  if (day === today) return 'today'
  if (day === mytDayKey(new Date(now.getTime() + DAY_MS))) return 'tomorrow'
  if (s.getTime() - now.getTime() < 7 * DAY_MS) return 'week'
  return 'later'
}

/** "Happening now" badge: only for events up to 24 hours long. */
export function showHappeningNow(startIso: string, endIso: string, now: Date = new Date()): boolean {
  return eventGroup(startIso, endIso, now) === 'now' && !isLongEvent(startIso, endIso)
}

/** For overnight input: end time earlier than start on the same date. */
export function endsNextDaySuggestion(startDate: string, startTime: string, endDate: string, endTime: string): string | null {
  if (startDate !== endDate || endTime >= startTime) return null
  const next = new Date(new Date(`${startDate}T00:00:00${MYT_OFFSET}`).getTime() + DAY_MS)
  return mytDayKey(next)
}
