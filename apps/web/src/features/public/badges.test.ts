import { describe, expect, it } from 'vitest'
import { badgesFor } from './badges.ts'

const now = new Date('2026-10-11T04:00:00Z') // Sun 11 Oct, 12:00 MYT
const post = (starts_at: string, ends_at: string, extra: { cancelled_at?: string; details_changed_at?: string } = {}) => ({
  starts_at,
  ends_at,
  cancelled_at: extra.cancelled_at ?? null,
  details_changed_at: extra.details_changed_at ?? null,
})

describe('badgesFor', () => {
  it('shows Happening now for a short event in progress', () => {
    expect(badgesFor(post('2026-10-11T03:00:00Z', '2026-10-11T05:00:00Z'), now)).toEqual([{ kind: 'now' }])
  })

  it('shows no time badge for a short event that has not started', () => {
    expect(badgesFor(post('2026-10-11T10:00:00Z', '2026-10-11T12:00:00Z'), now)).toEqual([])
  })

  it('treats exactly 24 hours as short', () => {
    expect(badgesFor(post('2026-10-11T00:00:00Z', '2026-10-12T00:00:00Z'), now)).toEqual([{ kind: 'now' }])
  })

  it('says On until <end> for an event longer than 24 hours, never Happening now', () => {
    expect(badgesFor(post('2026-10-09T01:00:00Z', '2026-10-13T09:00:00Z'), now)).toEqual([
      { kind: 'onUntil', until: '2026-10-13T09:00:00Z' },
    ])
    // ...also before it starts (the plan: multi-day events show "On until").
    expect(badgesFor(post('2026-10-20T01:00:00Z', '2026-10-22T09:00:00Z'), now)).toEqual([
      { kind: 'onUntil', until: '2026-10-22T09:00:00Z' },
    ])
  })

  it('adds Updated after a time or venue change', () => {
    expect(badgesFor(post('2026-10-11T03:00:00Z', '2026-10-11T05:00:00Z', { details_changed_at: '2026-10-10T00:00:00Z' }), now)).toEqual([
      { kind: 'now' },
      { kind: 'updated' },
    ])
    expect(badgesFor(post('2026-10-15T03:00:00Z', '2026-10-15T05:00:00Z', { details_changed_at: '2026-10-10T00:00:00Z' }), now)).toEqual([
      { kind: 'updated' },
    ])
  })

  it('shows only Cancelled for a cancelled event', () => {
    const cancelled = post('2026-10-11T03:00:00Z', '2026-10-11T05:00:00Z', {
      cancelled_at: '2026-10-10T00:00:00Z',
      details_changed_at: '2026-10-09T00:00:00Z',
    })
    expect(badgesFor(cancelled, now)).toEqual([{ kind: 'cancelled' }])
    expect(badgesFor(post('2026-10-09T01:00:00Z', '2026-10-13T09:00:00Z', { cancelled_at: '2026-10-10T00:00:00Z' }), now)).toEqual([
      { kind: 'cancelled' },
    ])
  })
})
