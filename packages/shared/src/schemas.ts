import { z } from 'zod'
import { CAMPUSES, LIMITS, ORG_TYPES } from './config.ts'
import { LINK_URL_RE } from './links.ts'
import { mytInputToIso } from './time.ts'

// zod 4 probes `new Function` unless told not to; our CSP has no 'unsafe-eval'.
z.config({ jitless: true })

const NO_CONTROL = /^[^\p{Cc}]*$/u
// Descriptions may contain newlines and nothing else from the control range.
const NO_CONTROL_EXCEPT_NEWLINE = /^[^\x01-\x09\x0b-\x1f\x7f]*$/

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/, 'username_format')

export const orgSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/, 'slug_format')

export const orgNameSchema = z.string().trim().min(2, 'too_short').max(100, 'too_long_text').regex(NO_CONTROL, 'bad_chars')

export const linkSchema = z
  .string()
  .trim()
  .max(LIMITS.linkMax, 'too_long_text')
  .regex(LINK_URL_RE, 'link_format')

const optionalText = (max: number, re: RegExp) =>
  z
    .string()
    .trim()
    .max(max, 'too_long_text')
    .regex(re, 'bad_chars')
    .transform((v) => (v === '' ? null : v))
    .nullable()

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_format')
const timeInput = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_format')

/** Studio form. Dates/times are MYT inputs; the output carries ISO instants. */
export const postFormSchema = z
  .object({
    title: z.string().trim().min(LIMITS.titleMin, 'too_short').max(LIMITS.titleMax, 'too_long_text').regex(NO_CONTROL, 'bad_chars'),
    venue: z.string().trim().min(LIMITS.venueMin, 'too_short').max(LIMITS.venueMax, 'too_long_text').regex(NO_CONTROL, 'bad_chars'),
    campus: z.enum(CAMPUSES),
    description: optionalText(LIMITS.descriptionMax, NO_CONTROL_EXCEPT_NEWLINE),
    link_url: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .pipe(linkSchema.nullable()),
    startDate: dateInput,
    startTime: timeInput,
    endDate: dateInput,
    endTime: timeInput,
  })
  .transform((v, ctx) => {
    let starts_at: string
    let ends_at: string
    try {
      starts_at = mytInputToIso(v.startDate, v.startTime)
      ends_at = mytInputToIso(v.endDate, v.endTime)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'date_format', path: ['startDate'] })
      return z.NEVER
    }
    return { title: v.title, venue: v.venue, campus: v.campus, description: v.description, link_url: v.link_url, starts_at, ends_at }
  })
  .superRefine((v, ctx) => {
    const s = Date.parse(v.starts_at)
    const e = Date.parse(v.ends_at)
    if (!(e > s)) ctx.addIssue({ code: 'custom', message: 'end_before_start', path: ['endTime'] })
    if (e - s > LIMITS.maxEventDays * 864e5) ctx.addIssue({ code: 'custom', message: 'too_long_event', path: ['endDate'] })
  })

export type PostFormOutput = z.output<typeof postFormSchema>

/** Extra rules that depend on "now" and on create vs edit (mirrors posts_guard). */
export function checkPostTiming(
  v: { starts_at: string; ends_at: string },
  mode: 'create' | { previousStartsAt: string },
  now: Date = new Date(),
): string | null {
  const s = Date.parse(v.starts_at)
  const e = Date.parse(v.ends_at)
  const n = now.getTime()
  if (s > n + LIMITS.maxDaysAhead * 864e5) return 'start_too_late'
  if (mode === 'create') {
    if (e < n + LIMITS.minMinutesLeftOnCreate * 6e4) return 'end_in_past'
  } else {
    if (v.starts_at !== mode.previousStartsAt && s < n - 36e5) return 'start_too_early'
    if (e <= n) return 'end_in_past'
  }
  return null
}

export const noticeFormSchema = z
  .object({
    title: z.string().trim().min(3, 'too_short').max(LIMITS.noticeTitleMax, 'too_long_text').regex(NO_CONTROL, 'bad_chars'),
    body: z.string().trim().min(1, 'too_short').max(LIMITS.noticeBodyMax, 'too_long_text').regex(NO_CONTROL_EXCEPT_NEWLINE, 'bad_chars'),
    link_url: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .pipe(linkSchema.nullable()),
    startDate: dateInput,
    startTime: timeInput,
    endDate: dateInput,
    endTime: timeInput,
  })
  .transform((v, ctx) => {
    try {
      return {
        title: v.title,
        body: v.body,
        link_url: v.link_url,
        starts_at: mytInputToIso(v.startDate, v.startTime),
        ends_at: mytInputToIso(v.endDate, v.endTime),
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'date_format', path: ['startDate'] })
      return z.NEVER
    }
  })
  .superRefine((v, ctx) => {
    const s = Date.parse(v.starts_at)
    const e = Date.parse(v.ends_at)
    if (!(e > s)) ctx.addIssue({ code: 'custom', message: 'end_before_start', path: ['endTime'] })
    if (e - s > LIMITS.noticeMaxDays * 864e5) ctx.addIssue({ code: 'custom', message: 'too_long_notice', path: ['endDate'] })
  })

export const createAccountSchema = z.object({
  username: usernameSchema,
  orgName: orgNameSchema,
  orgSlug: orgSlugSchema,
  type: z.enum(ORG_TYPES),
  campus: z.enum(CAMPUSES).refine((c) => c !== 'online', 'campus_physical'),
})
export type CreateAccountInput = z.output<typeof createAccountSchema>

/** Suggest a URL slug from an organisation name. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '')
}
