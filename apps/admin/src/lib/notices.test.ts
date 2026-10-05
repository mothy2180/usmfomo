import { describe, expect, it } from 'vitest'
import { defaultNoticeValues, groupNotices, noticeStatus, noticeToValues, validateNotice, type NoticeFormValues } from './notices.ts'

const now = new Date('2026-10-05T06:00:00Z') // 14:00 MYT

describe('noticeStatus', () => {
  it('mirrors the public rule starts_at <= now < ends_at', () => {
    expect(noticeStatus({ starts_at: '2026-10-05T06:00:00Z', ends_at: '2026-10-06T00:00:00Z' }, now)).toBe('live')
    expect(noticeStatus({ starts_at: '2026-10-05T06:00:01Z', ends_at: '2026-10-06T00:00:00Z' }, now)).toBe('scheduled')
    expect(noticeStatus({ starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-05T06:00:00Z' }, now)).toBe('expired')
  })

  it('groups and orders notices for the list', () => {
    const n = (id: string, starts_at: string, ends_at: string) => ({ id, starts_at, ends_at })
    const groups = groupNotices(
      [
        n('a', '2026-10-01T00:00:00Z', '2026-10-09T00:00:00Z'),
        n('b', '2026-10-02T00:00:00Z', '2026-10-07T00:00:00Z'),
        n('c', '2026-10-08T00:00:00Z', '2026-10-10T00:00:00Z'),
        n('d', '2026-10-06T00:00:00Z', '2026-10-10T00:00:00Z'),
        n('e', '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'),
        n('f', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'),
      ],
      now,
    )
    expect(groups.live.map((x) => x.id)).toEqual(['b', 'a'])
    expect(groups.scheduled.map((x) => x.id)).toEqual(['d', 'c'])
    expect(groups.expired.map((x) => x.id)).toEqual(['f', 'e'])
  })
})

describe('notice form values (MYT)', () => {
  it('defaults a new notice to now, for 7 days, in Malaysia time', () => {
    expect(defaultNoticeValues(new Date('2026-10-05T06:00:42Z'))).toEqual({
      title: '',
      body: '',
      link_url: '',
      startDate: '2026-10-05',
      startTime: '14:00',
      endDate: '2026-10-12',
      endTime: '14:00',
    })
  })

  it('round-trips a stored notice through the form', () => {
    const stored = { title: 'Hi', body: 'Body', link_url: null, starts_at: '2026-10-04T16:30:00.000Z', ends_at: '2026-10-11T16:30:00.000Z' }
    const values = noticeToValues(stored)
    expect(values).toMatchObject({ startDate: '2026-10-05', startTime: '00:30', endDate: '2026-10-12', endTime: '00:30', link_url: '' })
    const result = validateNotice({ ...values, title: 'Welcome back' }, now)
    expect(result).toEqual({
      ok: true,
      data: { title: 'Welcome back', body: 'Body', link_url: null, starts_at: stored.starts_at, ends_at: stored.ends_at },
    })
  })
})

describe('validateNotice (noticeFormSchema)', () => {
  const base: NoticeFormValues = {
    title: 'Registration week',
    body: 'Line one\nLine two',
    link_url: 'https://example.com/form',
    startDate: '2026-10-05',
    startTime: '14:00',
    endDate: '2026-10-12',
    endTime: '14:00',
  }

  it('accepts a valid notice and keeps line breaks in the body', () => {
    const r = validateNotice(base, now)
    expect(r.ok && r.data.body).toBe('Line one\nLine two')
    expect(r.ok && r.data.starts_at).toBe('2026-10-05T06:00:00.000Z')
  })

  it('maps schema problems to the right fields', () => {
    const r = validateNotice({ ...base, title: 'Hi', link_url: 'http://example.com' }, now)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.title).toBe('This is too short.')
    expect(r.errors.link_url).toMatch(/https:\/\//)
    // The time order is checked once the fields themselves are valid.
    const order = validateNotice({ ...base, endDate: '2026-10-05', endTime: '13:00' }, now)
    expect(order.ok ? null : order.errors.endTime).toBe('The end must be after the start.')
  })

  it('limits a notice to 180 days and rejects impossible dates', () => {
    const long = validateNotice({ ...base, endDate: '2027-05-01' }, now)
    expect(long.ok ? null : long.errors.endDate).toBe('A notice can be shown for at most 180 days.')
    const bad = validateNotice({ ...base, startDate: '2026-02-31' }, now)
    expect(bad.ok ? null : bad.errors.startDate).toBe('Enter a valid date.')
  })

  it('refuses a notice that has already ended', () => {
    const r = validateNotice({ ...base, startDate: '2026-10-01', endDate: '2026-10-05', endTime: '13:59' }, now)
    expect(r.ok ? null : r.errors.endDate).toBe('Choose an end time in the future.')
  })
})
