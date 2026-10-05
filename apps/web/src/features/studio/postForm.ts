// Post form: values <-> rows, validation (mirrors the database) and the
// payloads sent to PostgREST. Pure; the form component and tests use it.
import type { Campus } from '@usmfomo/shared/config'
import { checkPostTiming, postFormSchema, type PostFormOutput } from '@usmfomo/shared/schemas'
import { endsNextDaySuggestion, isoToMytInput, mytInputToIso } from '@usmfomo/shared/time'
import type { PostInsertRow, PostPatch, PostRow } from './types.ts'

export type PostFormValues = {
  title: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  venue: string
  campus: Campus
  description: string
  link_url: string
}

export type PostField = keyof PostFormValues
/** Field -> i18n key including its namespace, e.g. "errors:too_short". */
export type FieldErrors = Partial<Record<PostField, string>>
/** Validated form output: trimmed text, nulls for empty optionals, ISO instants. */
export type ValidPost = PostFormOutput

/** Visual order, used to focus the first invalid field. */
export const FIELD_ORDER: readonly PostField[] = [
  'title',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'venue',
  'campus',
  'description',
  'link_url',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const REQUIRED: readonly PostField[] = ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'venue']
// Messages postFormSchema can produce; each has a translation under errors:.
const SCHEMA_KEYS = new Set([
  'too_short',
  'too_long_text',
  'bad_chars',
  'link_format',
  'date_format',
  'time_format',
  'end_before_start',
  'too_long_event',
])
const TIMING_FIELD: Record<string, PostField> = {
  end_in_past: 'endTime',
  start_too_early: 'startTime',
  start_too_late: 'startDate',
}

/** Same instant, canonical form ("…+00:00" from PostgREST -> "…Z"). */
export const normalizeIso = (iso: string): string => new Date(iso).toISOString()

export function emptyPostValues(campus: Campus): PostFormValues {
  return { title: '', startDate: '', startTime: '', endDate: '', endTime: '', venue: '', campus, description: '', link_url: '' }
}

type EditablePost = Pick<PostRow, 'title' | 'venue' | 'campus' | 'description' | 'link_url' | 'starts_at' | 'ends_at'>

export function postToValues(post: EditablePost): PostFormValues {
  const s = isoToMytInput(post.starts_at)
  const e = isoToMytInput(post.ends_at)
  return {
    title: post.title,
    startDate: s.date,
    startTime: s.time,
    endDate: e.date,
    endTime: e.time,
    venue: post.venue,
    campus: post.campus,
    description: post.description ?? '',
    link_url: post.link_url ?? '',
  }
}

/** Changing the start date moves an untouched end date along with it
 * ("end date defaults to the start date"). */
export function withStartDate(values: PostFormValues, startDate: string, endTouched: boolean): PostFormValues {
  const follow = !endTouched || values.endDate === '' || values.endDate === values.startDate
  return { ...values, startDate, endDate: follow ? startDate : values.endDate }
}

/** "Ends next day?" — an end time earlier than the start on the same date. */
export function nextDaySuggestion(v: PostFormValues): string | null {
  if (![v.startDate, v.endDate].every((d) => DATE_RE.test(d)) || ![v.startTime, v.endTime].every((t) => TIME_RE.test(t))) {
    return null
  }
  return endsNextDaySuggestion(v.startDate, v.startTime, v.endDate, v.endTime)
}

/** Which halves of the schedule the form changed (minute precision, MYT). */
export function scheduleChanges(post: Pick<PostRow, 'starts_at' | 'ends_at'>, v: PostFormValues): { start: boolean; end: boolean } {
  const s = isoToMytInput(post.starts_at)
  const e = isoToMytInput(post.ends_at)
  return { start: s.date !== v.startDate || s.time !== v.startTime, end: e.date !== v.endDate || e.time !== v.endTime }
}

export type FormMode = { kind: 'create' } | { kind: 'edit'; post: Pick<PostRow, 'starts_at' | 'ends_at'> }
export type Validation = { ok: true; data: ValidPost } | { ok: false; errors: FieldErrors }

/**
 * postFormSchema, then checkPostTiming (create, or edit with the previous
 * start). On edit, unchanged dates keep their exact stored instants, so an
 * edit of the venue never moves the event by its seconds and the timing
 * rules run only when the schedule changed — like posts_guard.
 */
export function validatePostForm(values: PostFormValues, mode: FormMode, now: Date = new Date()): Validation {
  const errors: FieldErrors = {}
  for (const f of REQUIRED) {
    if (values[f].trim() === '') errors[f] = 'studio:form.required'
  }
  // Impossible calendar dates (31 Feb) belong to the date that has them.
  for (const [date, time] of [
    ['startDate', 'startTime'],
    ['endDate', 'endTime'],
  ] as const) {
    if (!errors[date] && DATE_RE.test(values[date]) && TIME_RE.test(values[time])) {
      try {
        mytInputToIso(values[date], values[time])
      } catch {
        errors[date] = 'errors:date_format'
      }
    }
  }

  const parsed = postFormSchema.safeParse(values)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if (typeof field !== 'string' || !(field in values)) continue
      const f = field as PostField
      if (!errors[f]) errors[f] = SCHEMA_KEYS.has(issue.message) ? `errors:${issue.message}` : 'errors:invalid_input'
    }
    // Every failure maps to some field; fall back to the title if not.
    if (Object.keys(errors).length === 0) errors.title = 'errors:invalid_input'
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors }

  let data = parsed.data
  let timing: string | null
  if (mode.kind === 'create') {
    timing = checkPostTiming(data, 'create', now)
  } else {
    const changed = scheduleChanges(mode.post, values)
    data = {
      ...data,
      starts_at: changed.start ? data.starts_at : normalizeIso(mode.post.starts_at),
      ends_at: changed.end ? data.ends_at : normalizeIso(mode.post.ends_at),
    }
    timing = changed.start || changed.end ? checkPostTiming(data, { previousStartsAt: normalizeIso(mode.post.starts_at) }, now) : null
  }
  if (timing) return { ok: false, errors: { [TIMING_FIELD[timing] ?? 'startDate']: `errors:${timing}` } }
  return { ok: true, data }
}

/** Insert payload: only granted columns; never org_id (set by the trigger). */
export function toInsertRow(data: ValidPost, poster: { poster: string; thumb: string } | null): PostInsertRow {
  return {
    title: data.title,
    venue: data.venue,
    campus: data.campus,
    description: data.description,
    link_url: data.link_url,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    poster_path: poster?.poster ?? null,
    thumb_path: poster?.thumb ?? null,
  }
}

/**
 * Update payload with only the columns that changed (every UPDATE counts
 * towards the 30 edits/24 h limit, and a schedule or venue change shows the
 * public "Updated" badge). Poster columns are added by submitPost.
 */
export function toUpdatePatch(post: PostRow, data: ValidPost, cancelled: boolean, now: Date = new Date()): PostPatch {
  const patch: PostPatch = {}
  if (data.title !== post.title) patch.title = data.title
  if (data.venue !== post.venue) patch.venue = data.venue
  if (data.campus !== post.campus) patch.campus = data.campus
  if (data.description !== post.description) patch.description = data.description
  if (data.link_url !== post.link_url) patch.link_url = data.link_url
  if (Date.parse(data.starts_at) !== Date.parse(post.starts_at)) patch.starts_at = data.starts_at
  if (Date.parse(data.ends_at) !== Date.parse(post.ends_at)) patch.ends_at = data.ends_at
  if (cancelled !== (post.cancelled_at !== null)) patch.cancelled_at = cancelled ? now.toISOString() : null
  return patch
}
