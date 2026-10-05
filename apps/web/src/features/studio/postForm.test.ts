import { describe, expect, it } from 'vitest'
import {
  emptyPostValues,
  nextDaySuggestion,
  normalizeIso,
  postToValues,
  scheduleChanges,
  toInsertRow,
  toUpdatePatch,
  validatePostForm,
  withStartDate,
  type PostFormValues,
} from './postForm.ts'
import type { PostRow } from './types.ts'

// Mon 5 Oct 2026, 10:00 MYT
const NOW = new Date('2026-10-05T02:00:00Z')
const ORG = '11111111-1111-4111-8111-111111111111'

const filled = (over: Partial<PostFormValues> = {}): PostFormValues => ({
  title: '  Hack Night  ',
  startDate: '2026-10-11',
  startTime: '20:00',
  endDate: '2026-10-11',
  endTime: '22:00',
  venue: ' DK A ',
  campus: 'main',
  description: '',
  link_url: '',
  ...over,
})

const row = (over: Partial<PostRow> = {}): PostRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  org_id: ORG,
  campus: 'main',
  title: 'Hack Night',
  venue: 'DK A',
  description: null,
  link_url: null,
  starts_at: '2026-10-11T12:00:00+00:00',
  ends_at: '2026-10-11T14:00:00+00:00',
  poster_path: null,
  thumb_path: null,
  cancelled_at: null,
  hidden_at: null,
  details_changed_at: null,
  created_at: '2026-10-01T00:00:00+00:00',
  updated_at: '2026-10-01T00:00:00+00:00',
  ...over,
})

describe('form values', () => {
  it('starts empty on the organisation’s campus', () => {
    expect(emptyPostValues('health')).toEqual({
      title: '', startDate: '', startTime: '', endDate: '', endTime: '', venue: '', campus: 'health', description: '', link_url: '',
    })
  })

  it('shows a stored post in Malaysia time whatever the device zone', () => {
    const v = postToValues(row({ starts_at: '2026-10-11T15:30:00+00:00', ends_at: '2026-10-11T17:00:00+00:00', description: 'Bring a laptop', link_url: 'https://forms.gle/x' }))
    // 15:30 UTC is 23:30 MYT; 17:00 UTC is 01:00 MYT the next day.
    expect(v).toMatchObject({ startDate: '2026-10-11', startTime: '23:30', endDate: '2026-10-12', endTime: '01:00' })
    expect(v.description).toBe('Bring a laptop')
    expect(postToValues(row()).link_url).toBe('')
  })

  it('moves an untouched end date along with the start date', () => {
    const v = filled({ startDate: '2026-10-11', endDate: '2026-10-11' })
    expect(withStartDate(v, '2026-10-12', false).endDate).toBe('2026-10-12')
    // Touched, but still equal to the old start date: keep following.
    expect(withStartDate(v, '2026-10-12', true).endDate).toBe('2026-10-12')
    // Touched and different (a multi-day event): leave it alone.
    expect(withStartDate({ ...v, endDate: '2026-10-14' }, '2026-10-12', true).endDate).toBe('2026-10-14')
    expect(withStartDate({ ...v, endDate: '' }, '2026-10-12', true).endDate).toBe('2026-10-12')
  })

  it('offers "ends next day" only for an overnight time on one date', () => {
    expect(nextDaySuggestion(filled({ startTime: '22:00', endTime: '02:00' }))).toBe('2026-10-12')
    expect(nextDaySuggestion(filled({ startDate: '2026-10-31', endDate: '2026-10-31', startTime: '23:00', endTime: '01:00' }))).toBe('2026-11-01')
    expect(nextDaySuggestion(filled())).toBeNull()
    expect(nextDaySuggestion(filled({ endTime: '' }))).toBeNull()
    expect(nextDaySuggestion(filled({ endDate: '2026-10-12', endTime: '02:00', startTime: '22:00' }))).toBeNull()
  })
})

describe('validatePostForm (create)', () => {
  it('marks every required field', () => {
    const r = validatePostForm(emptyPostValues('main'), { kind: 'create' }, NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    for (const f of ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'venue'] as const) {
      expect(r.errors[f]).toBe('studio:form.required')
    }
    expect(r.errors.description).toBeUndefined()
    expect(r.errors.link_url).toBeUndefined()
  })

  it('maps schema problems to their fields', () => {
    const r = validatePostForm(filled({ title: 'ab', venue: 'x', link_url: 'http://forms.gle/x' }), { kind: 'create' }, NOW)
    expect(r.ok === false && r.errors).toEqual({ title: 'errors:too_short', venue: 'errors:too_short', link_url: 'errors:link_format' })
  })

  it('rejects control characters but keeps newlines in descriptions', () => {
    expect(validatePostForm(filled({ title: 'Hack\u0007Night' }), { kind: 'create' }, NOW)).toMatchObject({ ok: false, errors: { title: 'errors:bad_chars' } })
    const r = validatePostForm(filled({ description: 'Line 1\nLine 2' }), { kind: 'create' }, NOW)
    expect(r.ok && r.data.description).toBe('Line 1\nLine 2')
  })

  it('puts an impossible calendar date on that date field', () => {
    const r = validatePostForm(filled({ startDate: '2026-02-31', endDate: '2026-03-01' }), { kind: 'create' }, NOW)
    expect(r.ok === false && r.errors.startDate).toBe('errors:date_format')
  })

  it('needs the end after the start, within 31 days', () => {
    expect(validatePostForm(filled({ endTime: '19:00' }), { kind: 'create' }, NOW)).toMatchObject({ ok: false, errors: { endTime: 'errors:end_before_start' } })
    expect(validatePostForm(filled({ endDate: '2026-11-12' }), { kind: 'create' }, NOW)).toMatchObject({ ok: false, errors: { endDate: 'errors:too_long_event' } })
  })

  it('applies the database timing rules for a new post', () => {
    // Ends in 10 minutes: a new post needs at least 15 minutes left.
    const soon = validatePostForm(filled({ startDate: '2026-10-05', startTime: '09:00', endDate: '2026-10-05', endTime: '10:10' }), { kind: 'create' }, NOW)
    expect(soon).toMatchObject({ ok: false, errors: { endTime: 'errors:end_in_past' } })
    // Already running with an hour left is fine.
    expect(validatePostForm(filled({ startDate: '2026-10-05', startTime: '09:00', endDate: '2026-10-05', endTime: '11:00' }), { kind: 'create' }, NOW).ok).toBe(true)
    const tooFar = validatePostForm(filled({ startDate: '2027-10-06', endDate: '2027-10-06' }), { kind: 'create' }, NOW)
    expect(tooFar).toMatchObject({ ok: false, errors: { startDate: 'errors:start_too_late' } })
  })

  it('returns trimmed text, nulls for empty optionals and UTC instants', () => {
    const r = validatePostForm(filled(), { kind: 'create' }, NOW)
    expect(r).toEqual({
      ok: true,
      data: {
        title: 'Hack Night',
        venue: 'DK A',
        campus: 'main',
        description: null,
        link_url: null,
        starts_at: '2026-10-11T12:00:00.000Z',
        ends_at: '2026-10-11T14:00:00.000Z',
      },
    })
  })
})

describe('validatePostForm (edit)', () => {
  // Started 3 hours ago (07:00 MYT), ends 18:00 MYT; stored with seconds.
  const running = row({ starts_at: '2026-10-04T23:00:30+00:00', ends_at: '2026-10-05T10:00:00+00:00' })

  it('keeps the stored instants when the schedule is unchanged, even for a running event', () => {
    const r = validatePostForm({ ...postToValues(running), venue: 'Dewan Utama' }, { kind: 'edit', post: running }, NOW)
    expect(r.ok).toBe(true)
    // Exact stored start (with its seconds), so the update leaves it alone.
    expect(r.ok && r.data.starts_at).toBe('2026-10-04T23:00:30.000Z')
    expect(r.ok && toUpdatePatch(running, r.data, false, NOW)).toEqual({ venue: 'Dewan Utama' })
  })

  it('refuses moving the start more than an hour into the past', () => {
    const r = validatePostForm({ ...postToValues(running), startTime: '08:00' }, { kind: 'edit', post: running }, NOW)
    expect(r).toMatchObject({ ok: false, errors: { startTime: 'errors:start_too_early' } })
  })

  it('refuses an end that is already over', () => {
    const r = validatePostForm({ ...postToValues(running), endTime: '09:30' }, { kind: 'edit', post: running }, NOW)
    expect(r).toMatchObject({ ok: false, errors: { endTime: 'errors:end_in_past' } })
  })

  it('reports which half of the schedule changed', () => {
    const v = postToValues(running)
    expect(scheduleChanges(running, v)).toEqual({ start: false, end: false })
    expect(scheduleChanges(running, { ...v, endTime: '19:00' })).toEqual({ start: false, end: true })
    expect(scheduleChanges(running, { ...v, startDate: '2026-10-06' })).toEqual({ start: true, end: false })
  })
})

describe('payloads', () => {
  const data = {
    title: 'Hack Night',
    venue: 'DK A',
    campus: 'engineering' as const,
    description: 'Bring a laptop',
    link_url: 'https://forms.gle/abc',
    starts_at: '2026-10-11T12:00:00.000Z',
    ends_at: '2026-10-11T14:00:00.000Z',
  }

  it('inserts only granted columns, never org_id', () => {
    const insert = toInsertRow(data, { poster: `${ORG}/a.webp`, thumb: `${ORG}/a-thumb.webp` })
    expect(Object.keys(insert).sort()).toEqual(['campus', 'description', 'ends_at', 'link_url', 'poster_path', 'starts_at', 'thumb_path', 'title', 'venue'])
    expect(insert).toMatchObject({ poster_path: `${ORG}/a.webp`, thumb_path: `${ORG}/a-thumb.webp` })
    expect(toInsertRow(data, null)).toMatchObject({ poster_path: null, thumb_path: null })
  })

  it('updates only what changed (every update counts towards the edit limit)', () => {
    const post = row()
    const same = { ...data, campus: 'main' as const, description: null, link_url: null }
    expect(toUpdatePatch(post, same, false, NOW)).toEqual({})
    expect(toUpdatePatch(post, { ...same, title: 'Hack Night II', ends_at: '2026-10-11T15:00:00.000Z' }, false, NOW)).toEqual({
      title: 'Hack Night II',
      ends_at: '2026-10-11T15:00:00.000Z',
    })
    // The same instant written differently is not a change.
    expect(toUpdatePatch(post, { ...same, starts_at: normalizeIso(post.starts_at) }, false, NOW)).toEqual({})
  })

  it('sets and clears cancelled_at from the toggle', () => {
    expect(toUpdatePatch(row(), { ...data, campus: 'main', description: null, link_url: null }, true, NOW)).toEqual({ cancelled_at: NOW.toISOString() })
    const cancelled = row({ cancelled_at: '2026-10-02T00:00:00+00:00' })
    expect(toUpdatePatch(cancelled, { ...data, campus: 'main', description: null, link_url: null }, false, NOW)).toEqual({ cancelled_at: null })
    expect(toUpdatePatch(cancelled, { ...data, campus: 'main', description: null, link_url: null }, true, NOW)).toEqual({})
  })
})
