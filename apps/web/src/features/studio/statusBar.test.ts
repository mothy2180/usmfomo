import { describe, expect, it } from 'vitest'
import i18n from '../../lib/i18n.ts'
import type { OkStatus } from '../../lib/session.ts'
import { editBlock, formatSlotTime, newPostBlock, newPostBlockText, statusBarItems, statusBarParts } from './statusBar.ts'

const status = (over: Partial<OkStatus> = {}): OkStatus => ({
  state: 'ok',
  username: 'robotik',
  org: { id: '11111111-1111-4111-8111-111111111111', name: 'Kelab Robotik', slug: 'robotik', type: 'club', campus: 'main' },
  posting_enabled: true,
  live: 12,
  live_limit: 15,
  new_24h: 3,
  new_limit: 5,
  next_slot_at: null,
  edits_24h: 4,
  edits_limit: 30,
  factors: 2,
  ...over,
})

// Mon 5 Oct 2026, 10:00 MYT
const NOW = new Date('2026-10-05T02:00:00Z')
const en = i18n.getFixedT('en', 'studio')
const ms = i18n.getFixedT('ms', 'studio')

describe('status bar', () => {
  it('reads "Live 12/15 · New in last 24 h 3/5"', () => {
    expect(statusBarItems(en, statusBarParts(status(), NOW, 'en')).join(' · ')).toBe('Live 12/15 · New in last 24 h 3/5')
  })

  it('adds the next slot (MYT, 24-hour) once the daily limit is used up', () => {
    // 06:20 UTC = 14:20 MYT, the same MYT day as NOW.
    const full = status({ new_24h: 5, next_slot_at: '2026-10-05T06:20:00+00:00' })
    expect(statusBarItems(en, statusBarParts(full, NOW, 'en')).join(' · ')).toBe('Live 12/15 · New in last 24 h 5/5 · next slot 14:20')
    expect(statusBarItems(ms, statusBarParts(full, NOW, 'ms')).join(' · ')).toBe('Aktif 12/15 · Baharu dalam 24 jam lalu 5/5 · slot seterusnya 14:20')
  })

  it('ignores a next slot while the daily limit is not full', () => {
    const parts = statusBarParts(status({ new_24h: 4, next_slot_at: '2026-10-05T06:20:00Z' }), NOW, 'en')
    expect(parts.nextSlot).toBeNull()
    expect(parts.daily).toEqual({ used: 4, limit: 5, full: false })
  })

  it('flags full limits', () => {
    const parts = statusBarParts(status({ live: 15, edits_24h: 30 }), NOW)
    expect(parts.live.full).toBe(true)
    expect(parts.edits).toEqual({ used: 30, limit: 30, full: true })
  })

  it('names the day when the next slot is not today in Malaysia', () => {
    // 23:30 MYT Monday; the slot opens 00:20 MYT Tuesday.
    const lateMonday = new Date('2026-10-05T15:30:00Z')
    expect(formatSlotTime('2026-10-05T16:20:00Z', lateMonday, 'en')).toBe('Tue 6 Oct 00:20')
    expect(formatSlotTime('2026-10-05T15:50:00Z', lateMonday, 'en')).toBe('23:50')
  })
})

describe('why New post / Edit is unavailable', () => {
  it('puts the kill switch first, then the live cap, then the daily cap', () => {
    expect(newPostBlock(status())).toBeNull()
    expect(newPostBlock(status({ new_24h: 5 }))).toBe('daily')
    expect(newPostBlock(status({ live: 15, new_24h: 5 }))).toBe('live')
    expect(newPostBlock(status({ posting_enabled: false, live: 15 }))).toBe('paused')
    expect(editBlock(status())).toBeNull()
    expect(editBlock(status({ edits_24h: 30 }))).toBe('edits')
    expect(editBlock(status({ posting_enabled: false, edits_24h: 30 }))).toBe('paused')
  })

  it('explains the block with the database limits', () => {
    expect(newPostBlockText(en, status(), NOW, 'en')).toBeNull()
    expect(newPostBlockText(en, status({ posting_enabled: false }), NOW, 'en')).toBe('Posting is paused by the usmfomo admin. Your live posts stay visible.')
    expect(newPostBlockText(en, status({ live: 15 }), NOW, 'en')).toBe('You have 15 live posts. Delete one or wait until one ends.')
    expect(newPostBlockText(en, status({ new_24h: 5 }), NOW, 'en')).toBe("You've made 5 new posts in the last 24 hours.")
    expect(newPostBlockText(en, status({ new_24h: 5, next_slot_at: '2026-10-05T06:20:00Z' }), NOW, 'en')).toBe(
      "You've made 5 new posts in the last 24 hours. Next slot: 14:20.",
    )
  })
})
