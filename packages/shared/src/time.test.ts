import { describe, expect, it } from 'vitest'
import {
  endsNextDaySuggestion,
  eventGroup,
  formatEventRange,
  isoToMytInput,
  mytDayKey,
  mytInputToIso,
  showHappeningNow,
} from './time.ts'

describe('MYT conversion', () => {
  it('converts MYT input to a UTC instant', () => {
    expect(mytInputToIso('2026-10-11', '20:00')).toBe('2026-10-11T12:00:00.000Z')
    expect(mytInputToIso('2026-10-12', '02:30')).toBe('2026-10-11T18:30:00.000Z')
  })

  it('round-trips an instant back to MYT input', () => {
    expect(isoToMytInput('2026-10-11T18:30:00.000Z')).toEqual({ date: '2026-10-12', time: '02:30' })
    expect(isoToMytInput('2026-10-11T16:00:00.000Z')).toEqual({ date: '2026-10-12', time: '00:00' })
  })

  it('rejects malformed or impossible input', () => {
    expect(() => mytInputToIso('2026-10-1', '20:00')).toThrow()
    expect(() => mytInputToIso('2026-10-11', '24:00')).toThrow()
    expect(() => mytInputToIso('2026-02-31', '10:00')).toThrow()
  })

  it('does not depend on the device time zone', () => {
    // Intl is used with an explicit timeZone, so TZ of the test process is irrelevant;
    // 23:30 UTC is already the next calendar day in Malaysia.
    expect(mytDayKey('2026-10-11T23:30:00.000Z')).toBe('2026-10-12')
  })
})

describe('formatEventRange', () => {
  it('same-day range shares the period', () => {
    expect(formatEventRange('2026-10-11T12:00:00Z', '2026-10-11T14:00:00Z')).toBe('Sun 11 Oct · 8:00–10:00 PM')
  })

  it('same-day range across noon shows both periods', () => {
    expect(formatEventRange('2026-10-11T02:00:00Z', '2026-10-11T06:00:00Z')).toBe('Sun 11 Oct · 10:00 AM–2:00 PM')
  })

  it('overnight range writes both days', () => {
    expect(formatEventRange('2026-10-11T14:00:00Z', '2026-10-11T18:00:00Z')).toBe('Sun 11 Oct 10:00 PM – Mon 12 Oct 2:00 AM')
  })

  it('multi-day range shows only days', () => {
    expect(formatEventRange('2026-10-06T01:00:00Z', '2026-10-10T09:00:00Z')).toBe('Tue 6 – Sat 10 Oct')
    expect(formatEventRange('2026-10-30T01:00:00Z', '2026-11-02T09:00:00Z')).toBe('Fri 30 Oct – Mon 2 Nov')
  })

  it('formats in Bahasa Malaysia', () => {
    const s = formatEventRange('2026-10-11T12:00:00Z', '2026-10-11T14:00:00Z', 'ms')
    expect(s).toContain('11')
    expect(s).toContain('Okt')
  })
})

describe('grouping', () => {
  const now = new Date('2026-10-11T04:00:00Z') // Sun 11 Oct, 12:00 MYT

  it('groups by MYT calendar day', () => {
    expect(eventGroup('2026-10-11T03:00:00Z', '2026-10-11T05:00:00Z', now)).toBe('now')
    expect(eventGroup('2026-10-11T10:00:00Z', '2026-10-11T12:00:00Z', now)).toBe('today')
    expect(eventGroup('2026-10-12T01:00:00Z', '2026-10-12T02:00:00Z', now)).toBe('tomorrow')
    expect(eventGroup('2026-10-15T01:00:00Z', '2026-10-15T02:00:00Z', now)).toBe('week')
    expect(eventGroup('2026-10-30T01:00:00Z', '2026-10-30T02:00:00Z', now)).toBe('later')
  })

  it('treats 23:30 MYT as today, not tomorrow', () => {
    expect(eventGroup('2026-10-11T15:30:00Z', '2026-10-11T16:30:00Z', now)).toBe('today')
  })

  it('only short events get the Happening now badge', () => {
    expect(showHappeningNow('2026-10-11T03:00:00Z', '2026-10-11T05:00:00Z', now)).toBe(true)
    expect(showHappeningNow('2026-10-09T03:00:00Z', '2026-10-13T05:00:00Z', now)).toBe(false)
  })
})

describe('overnight suggestion', () => {
  it('offers the next day when the end time is earlier on the same date', () => {
    expect(endsNextDaySuggestion('2026-10-11', '22:00', '2026-10-11', '02:00')).toBe('2026-10-12')
    expect(endsNextDaySuggestion('2026-10-31', '22:00', '2026-10-31', '01:00')).toBe('2026-11-01')
  })

  it('stays quiet otherwise', () => {
    expect(endsNextDaySuggestion('2026-10-11', '20:00', '2026-10-11', '22:00')).toBeNull()
    expect(endsNextDaySuggestion('2026-10-11', '22:00', '2026-10-12', '02:00')).toBeNull()
  })
})
