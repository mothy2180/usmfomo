import { describe, expect, it } from 'vitest'
import {
  MAINTENANCE_STALE_MS,
  STORAGE_QUOTA_BYTES,
  formatAge,
  formatBytes,
  formatMytDateTime,
  isMaintenanceStale,
  isWithinDays,
  percentOf,
  plural,
} from './format.ts'

const now = new Date('2026-10-05T06:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

describe('maintenance age', () => {
  it('formats the age of the last run', () => {
    expect(formatAge(ago(20_000), now)).toBe('just now')
    expect(formatAge(ago(MIN), now)).toBe('1 min ago')
    expect(formatAge(ago(53 * MIN), now)).toBe('53 min ago')
    expect(formatAge(ago(HOUR), now)).toBe('1 h ago')
    expect(formatAge(ago(3 * HOUR + 5 * MIN), now)).toBe('3 h 5 min ago')
    expect(formatAge(ago(24 * HOUR), now)).toBe('1 day ago')
    expect(formatAge(ago(9 * 24 * HOUR), now)).toBe('9 days ago')
  })

  it('says "never" when maintenance never ran, and copes with bad input', () => {
    expect(formatAge(null, now)).toBe('never')
    expect(formatAge('not a date', now)).toBe('unknown')
  })

  it('treats clock skew (a run "in the future") as just now', () => {
    expect(formatAge(new Date(now.getTime() + 30_000).toISOString(), now)).toBe('just now')
  })

  it('turns red only after more than 3 hours', () => {
    expect(MAINTENANCE_STALE_MS).toBe(3 * HOUR)
    expect(isMaintenanceStale(ago(HOUR), now)).toBe(false)
    expect(isMaintenanceStale(ago(3 * HOUR), now)).toBe(false)
    expect(isMaintenanceStale(ago(3 * HOUR + 1000), now)).toBe(true)
    expect(isMaintenanceStale(null, now)).toBe(true)
    expect(isMaintenanceStale('garbage', now)).toBe(true)
  })
})

describe('storage', () => {
  it('formats bytes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(350 * 1024)).toBe('350 KB')
    expect(formatBytes(800 * 1024 ** 2)).toBe('800 MB')
    expect(formatBytes(STORAGE_QUOTA_BYTES)).toBe('1.0 GB')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })

  it('computes a clamped whole percentage of the 1 GB quota', () => {
    expect(percentOf(0, STORAGE_QUOTA_BYTES)).toBe(0)
    expect(percentOf(STORAGE_QUOTA_BYTES / 4, STORAGE_QUOTA_BYTES)).toBe(25)
    expect(percentOf(STORAGE_QUOTA_BYTES * 2, STORAGE_QUOTA_BYTES)).toBe(100)
    expect(percentOf(5, 0)).toBe(0)
  })
})

describe('dates', () => {
  it('shows instants in Malaysia time whatever the device zone', () => {
    // 06:20 UTC = 14:20 MYT
    expect(formatMytDateTime('2026-10-05T06:20:00Z')).toBe('Mon 5 Oct 2026, 2:20 PM')
    // 16:30 UTC on the 4th = 00:30 on the 5th in MYT
    expect(formatMytDateTime('2026-10-04T16:30:00Z')).toBe('Mon 5 Oct 2026, 12:30 AM')
    expect(formatMytDateTime(null)).toBe('—')
    expect(formatMytDateTime('nope')).toBe('—')
  })

  it('tells whether a date falls within the last N days', () => {
    expect(isWithinDays(ago(6 * 24 * HOUR), 7, now)).toBe(true)
    expect(isWithinDays(ago(7 * 24 * HOUR + 1), 7, now)).toBe(false)
    expect(isWithinDays(null, 7, now)).toBe(false)
  })

  it('pluralises counts', () => {
    expect(plural(1, 'post')).toBe('1 post')
    expect(plural(0, 'post')).toBe('0 posts')
    expect(plural(2, 'notice')).toBe('2 notices')
  })
})
