import { describe, expect, it } from 'vitest'
import { SWEEP_STALE_MS, failedStepLabels, isSweepOverdue, readMaintenanceResult, runFailed } from './maintenance.ts'

const now = new Date('2026-10-06T06:00:00Z')
const HOUR = 60 * 60_000
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

/** A heartbeat result as runMaintenance() writes it (supabase/functions/maintenance/run.ts). */
const RESULT = {
  ok: false,
  purged: { posts: 3, notices: 1 },
  files: 4,
  orphans: null,
  retention: null,
  failed: ['files', 'orphans'],
  at: '2026-10-06T05:07:00.000Z',
  swept_at: '2026-10-05T19:07:00.000Z',
}

describe('readMaintenanceResult', () => {
  it('reads ok, failed steps, counts and the last sweep', () => {
    expect(readMaintenanceResult(RESULT)).toEqual({
      ok: false,
      failed: ['files', 'orphans'],
      posts: 3,
      notices: 1,
      files: 4,
      orphans: null,
      sweptAt: '2026-10-05T19:07:00.000Z',
    })
  })

  it('copes with a missing or odd result', () => {
    expect(readMaintenanceResult(null)).toBeNull()
    expect(readMaintenanceResult('done')).toBeNull()
    expect(readMaintenanceResult([1, 2])).toBeNull()
    expect(readMaintenanceResult({ failed: 'files', ok: 'no', swept_at: 5 })).toEqual({
      ok: null,
      failed: [],
      posts: null,
      notices: null,
      files: null,
      orphans: null,
      sweptAt: null,
    })
    expect(readMaintenanceResult({ failed: ['purge', 7] })?.failed).toEqual(['purge'])
  })
})

describe('runFailed', () => {
  it('is true when ok is false or any step failed', () => {
    expect(runFailed(readMaintenanceResult(RESULT))).toBe(true)
    expect(runFailed(readMaintenanceResult({ ok: false, failed: [] }))).toBe(true)
    expect(runFailed(readMaintenanceResult({ failed: ['retention'] }))).toBe(true)
  })

  it('is false for a clean run or no result at all', () => {
    expect(runFailed(readMaintenanceResult({ ...RESULT, ok: true, failed: [] }))).toBe(false)
    expect(runFailed(readMaintenanceResult({ purged: { posts: 1, notices: 0 }, files: 2 }))).toBe(false)
    expect(runFailed(null)).toBe(false)
  })
})

describe('failedStepLabels', () => {
  it('names each step in plain English and keeps unknown ones', () => {
    expect(failedStepLabels(['files', 'orphans', 'something_new'])).toEqual([
      'deleting the poster files of purged posts',
      'the daily sweep of orphaned poster files',
      'something_new',
    ])
  })
})

describe('isSweepOverdue', () => {
  it('turns true after 26 hours', () => {
    expect(SWEEP_STALE_MS).toBe(26 * HOUR)
    expect(isSweepOverdue(ago(25 * HOUR), now)).toBe(false)
    expect(isSweepOverdue(ago(26 * HOUR), now)).toBe(false)
    expect(isSweepOverdue(ago(26 * HOUR + 60_000), now)).toBe(true)
  })

  it('treats an unknown sweep time as not overdue', () => {
    expect(isSweepOverdue(null, now)).toBe(false)
    expect(isSweepOverdue('not a date', now)).toBe(false)
  })
})
