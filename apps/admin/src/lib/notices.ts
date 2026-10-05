import { noticeFormSchema } from '@usmfomo/shared/schemas'
import { isoToMytInput } from '@usmfomo/shared/time'
import { fieldErrors, VALIDATION_MESSAGES, type Validated } from './forms.ts'
import type { z } from './zod.ts'

export const NOTICE_STATUSES = ['live', 'scheduled', 'expired'] as const
export type NoticeStatus = (typeof NOTICE_STATUSES)[number]

export const NOTICE_STATUS_LABELS: Record<NoticeStatus, string> = {
  live: 'Live',
  scheduled: 'Scheduled',
  expired: 'Expired',
}

/** Mirrors notices_public_read: shown while starts_at <= now < ends_at. */
export function noticeStatus(n: { starts_at: string; ends_at: string }, now: Date): NoticeStatus {
  const t = now.getTime()
  if (Date.parse(n.ends_at) <= t) return 'expired'
  if (Date.parse(n.starts_at) > t) return 'scheduled'
  return 'live'
}

/** Raw form values: MYT date ("YYYY-MM-DD") and time ("HH:MM") inputs. */
export type NoticeFormValues = {
  title: string
  body: string
  link_url: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

/** New notice: shown from this minute for 7 days (MYT has no daylight saving). */
export function defaultNoticeValues(now: Date): NoticeFormValues {
  const startMs = Math.floor(now.getTime() / 60_000) * 60_000
  const start = isoToMytInput(new Date(startMs).toISOString())
  const end = isoToMytInput(new Date(startMs + 7 * 24 * 60 * 60 * 1000).toISOString())
  return { title: '', body: '', link_url: '', startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time }
}

export function noticeToValues(n: {
  title: string
  body: string
  link_url: string | null
  starts_at: string
  ends_at: string
}): NoticeFormValues {
  const start = isoToMytInput(n.starts_at)
  const end = isoToMytInput(n.ends_at)
  return {
    title: n.title,
    body: n.body,
    link_url: n.link_url ?? '',
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  }
}

/** Live (ending soonest first), scheduled (starting soonest first), expired (latest first). */
export function groupNotices<T extends { starts_at: string; ends_at: string }>(rows: readonly T[], now: Date): Record<NoticeStatus, T[]> {
  const out: Record<NoticeStatus, T[]> = { live: [], scheduled: [], expired: [] }
  for (const n of rows) out[noticeStatus(n, now)].push(n)
  out.live.sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at))
  out.scheduled.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  out.expired.sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at))
  return out
}

/** Form order, for focusing the first invalid field. */
export const NOTICE_FIELDS = ['title', 'body', 'link_url', 'startDate', 'startTime', 'endDate', 'endTime'] as const

export type NoticeData = z.output<typeof noticeFormSchema>

/** noticeFormSchema (MYT inputs -> ISO instants) plus "it must end in the
 * future": a notice that already ended would never be shown. */
export function validateNotice(values: NoticeFormValues, now: Date): Validated<NoticeData> {
  const parsed = noticeFormSchema.safeParse(values)
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error.issues) }
  if (Date.parse(parsed.data.ends_at) <= now.getTime()) {
    return { ok: false, errors: { endDate: VALIDATION_MESSAGES.end_in_past } }
  }
  return { ok: true, data: parsed.data }
}
