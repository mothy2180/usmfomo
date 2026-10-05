import { describe, expect, it } from 'vitest'
import { groupIntoSections } from './sections.ts'

const now = new Date('2026-10-11T04:00:00Z') // Sun 11 Oct, 12:00 MYT
const ev = (id: string, starts_at: string, ends_at: string) => ({ id, starts_at, ends_at })
const ids = (sections: ReturnType<typeof groupIntoSections<{ id: string; starts_at: string; ends_at: string }>>) =>
  sections.map((s) => [s.group, s.items.map((i) => i.id)])

describe('groupIntoSections', () => {
  it('orders the sections Happening now, Today, Tomorrow, This week, Later', () => {
    const items = [
      ev('later', '2026-10-30T01:00:00Z', '2026-10-30T02:00:00Z'),
      ev('week', '2026-10-15T01:00:00Z', '2026-10-15T02:00:00Z'),
      ev('tomorrow', '2026-10-12T01:00:00Z', '2026-10-12T02:00:00Z'),
      ev('today', '2026-10-11T10:00:00Z', '2026-10-11T12:00:00Z'),
      ev('now', '2026-10-11T03:00:00Z', '2026-10-11T05:00:00Z'),
    ]
    expect(ids(groupIntoSections(items, now))).toEqual([
      ['now', ['now']],
      ['today', ['today']],
      ['tomorrow', ['tomorrow']],
      ['week', ['week']],
      ['later', ['later']],
    ])
  })

  it('leaves out empty sections', () => {
    const items = [ev('a', '2026-10-12T01:00:00Z', '2026-10-12T02:00:00Z')]
    expect(ids(groupIntoSections(items, now))).toEqual([['tomorrow', ['a']]])
    expect(groupIntoSections([], now)).toEqual([])
  })

  it('sorts Happening now by soonest end and other sections by start', () => {
    const items = [
      ev('ends-late', '2026-10-11T02:00:00Z', '2026-10-11T09:00:00Z'),
      ev('ends-soon', '2026-10-11T03:30:00Z', '2026-10-11T04:30:00Z'),
      ev('today-late', '2026-10-11T12:00:00Z', '2026-10-11T13:00:00Z'),
      ev('today-early', '2026-10-11T06:00:00Z', '2026-10-11T07:00:00Z'),
    ]
    expect(ids(groupIntoSections(items, now))).toEqual([
      ['now', ['ends-soon', 'ends-late']],
      ['today', ['today-early', 'today-late']],
    ])
  })

  it('keeps the database order when times are equal', () => {
    const items = [
      ev('b', '2026-10-12T01:00:00Z', '2026-10-12T02:00:00Z'),
      ev('a', '2026-10-12T01:00:00Z', '2026-10-12T02:00:00Z'),
    ]
    expect(ids(groupIntoSections(items, now))).toEqual([['tomorrow', ['b', 'a']]])
  })

  it('drops events that ended after they were fetched', () => {
    const items = [
      ev('ended', '2026-10-11T01:00:00Z', '2026-10-11T03:59:00Z'),
      ev('ends-now', '2026-10-11T01:00:00Z', '2026-10-11T04:00:00Z'),
      ev('live', '2026-10-11T01:00:00Z', '2026-10-11T04:01:00Z'),
    ]
    expect(ids(groupIntoSections(items, now))).toEqual([['now', ['live']]])
  })

  it('moves an event into Happening now once it starts', () => {
    const item = ev('talk', '2026-10-11T05:00:00Z', '2026-10-11T06:00:00Z')
    expect(ids(groupIntoSections([item], now))).toEqual([['today', ['talk']]])
    expect(ids(groupIntoSections([item], new Date('2026-10-11T05:00:00Z')))).toEqual([['now', ['talk']]])
  })

  it('lists a multi-day event that already started under Happening now', () => {
    const items = [ev('expo', '2026-10-09T01:00:00Z', '2026-10-13T09:00:00Z')]
    expect(ids(groupIntoSections(items, now))).toEqual([['now', ['expo']]])
  })

  it('uses Malaysia calendar days, whatever the device time zone', () => {
    const items = [
      ev('late-tonight', '2026-10-11T15:30:00Z', '2026-10-11T16:30:00Z'), // 23:30 MYT Sun
      ev('after-midnight', '2026-10-11T16:30:00Z', '2026-10-11T17:30:00Z'), // 00:30 MYT Mon
    ]
    expect(ids(groupIntoSections(items, now))).toEqual([
      ['today', ['late-tonight']],
      ['tomorrow', ['after-midnight']],
    ])
  })
})
