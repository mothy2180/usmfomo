import { assertEquals, assertRejects } from '@std/assert'
import { lastSweepBoundary, type MaintenancePort, type PurgedRow, runMaintenance, shouldSweep } from './run.ts'

const at = (iso: string) => new Date(iso)

Deno.test('lastSweepBoundary: the most recent 19:00 UTC (03:00 MYT)', () => {
  assertEquals(new Date(lastSweepBoundary(at('2026-10-05T18:59:59Z'))).toISOString(), '2026-10-04T19:00:00.000Z')
  assertEquals(new Date(lastSweepBoundary(at('2026-10-05T19:00:00Z'))).toISOString(), '2026-10-05T19:00:00.000Z')
  assertEquals(new Date(lastSweepBoundary(at('2026-10-05T23:30:00Z'))).toISOString(), '2026-10-05T19:00:00.000Z')
  assertEquals(new Date(lastSweepBoundary(at('2026-10-06T00:07:00Z'))).toISOString(), '2026-10-05T19:00:00.000Z')
  assertEquals(new Date(lastSweepBoundary(at('2026-01-01T03:00:00Z'))).toISOString(), '2025-12-31T19:00:00.000Z')
})

Deno.test('shouldSweep: first run after 19:00 UTC each day', () => {
  const swept = '2026-10-04T19:07:00.000Z'
  assertEquals(shouldSweep(at('2026-10-05T18:07:00Z'), swept, false), false)
  assertEquals(shouldSweep(at('2026-10-05T19:07:00Z'), swept, false), true)
  assertEquals(shouldSweep(at('2026-10-05T20:07:00Z'), '2026-10-05T19:07:00.000Z', false), false)
  // A missed 19:07 run is caught up by the next one.
  assertEquals(shouldSweep(at('2026-10-05T21:07:00Z'), swept, false), true)
})

Deno.test('shouldSweep: forced, never swept, unknown, invalid', () => {
  assertEquals(shouldSweep(at('2026-10-05T10:07:00Z'), '2026-10-05T09:00:00Z', true), true)
  assertEquals(shouldSweep(at('2026-10-05T10:07:00Z'), null, false), true)
  assertEquals(shouldSweep(at('2026-10-05T10:07:00Z'), undefined, false), false)
  assertEquals(shouldSweep(at('2026-10-05T19:07:00Z'), undefined, false), true)
  assertEquals(shouldSweep(at('2026-10-05T10:07:00Z'), 'garbage', false), true)
})

type Recorded = { heartbeats: Array<Record<string, unknown> | null>; removed: Array<ReadonlyArray<string | null>> }

function port(overrides: Partial<MaintenancePort> = {}): { port: MaintenancePort; rec: Recorded } {
  const rec: Recorded = { heartbeats: [], removed: [] }
  const rows: PurgedRow[] = [
    { kind: 'post', id: 'p1', poster_path: 'o/1.webp', thumb_path: 'o/1-thumb.webp' },
    { kind: 'post', id: 'p2', poster_path: null, thumb_path: null },
    { kind: 'notice', id: 'n1', poster_path: null, thumb_path: null },
  ]
  return {
    rec,
    port: {
      heartbeat: (r) => {
        rec.heartbeats.push(r)
        return Promise.resolve()
      },
      purgeExpired: () => Promise.resolve(rows),
      lastSweptAt: () => Promise.resolve('2026-10-05T19:07:00.000Z'),
      orphans: () => Promise.resolve(['o/old.webp', 'o/old-thumb.webp', 'o/x.jpg']),
      retention: () => Promise.resolve({ post_log: 4, audit: 1 }),
      removeFiles: (paths) => {
        rec.removed.push(paths)
        return Promise.resolve({ removed: paths.filter((p) => p).length, failed: 0 })
      },
      ...overrides,
    },
  }
}

const NOT_DUE = at('2026-10-05T21:07:00Z')
const DUE = at('2026-10-06T19:07:00Z')

Deno.test('runMaintenance: hourly run without the daily sweep', async () => {
  const { port: p, rec } = port()
  const summary = await runMaintenance(p, { now: NOT_DUE })
  assertEquals(summary, {
    ok: true,
    purged: { posts: 2, notices: 1 },
    files: 2,
    orphans: null,
    retention: null,
    failed: [],
    at: NOT_DUE.toISOString(),
    swept_at: '2026-10-05T19:07:00.000Z',
  })
  assertEquals(rec.heartbeats.length, 2)
  assertEquals(rec.heartbeats[0], null)
  assertEquals(rec.heartbeats[1], { ...summary })
  assertEquals(rec.removed, [['o/1.webp', 'o/1-thumb.webp', null, null, null, null]])
})

Deno.test('runMaintenance: daily sweep when due, recorded in swept_at', async () => {
  const { port: p, rec } = port()
  const summary = await runMaintenance(p, { now: DUE })
  assertEquals(summary.orphans, 3)
  assertEquals(summary.retention, { post_log: 4, audit: 1 })
  assertEquals(summary.swept_at, DUE.toISOString())
  assertEquals(rec.removed.length, 2)
  assertEquals(rec.heartbeats[1]?.swept_at, DUE.toISOString())
})

Deno.test('runMaintenance: ?sweep=1 forces the sweep', async () => {
  const { port: p } = port()
  const summary = await runMaintenance(p, { now: NOT_DUE, force: true })
  assertEquals(summary.orphans, 3)
  assertEquals(summary.swept_at, NOT_DUE.toISOString())
})

Deno.test('runMaintenance: a failed sweep keeps the purge result and is retried next run', async () => {
  const { port: p, rec } = port({ orphans: () => Promise.reject(new Error('db')) })
  const summary = await runMaintenance(p, { now: DUE })
  assertEquals(summary.ok, false)
  assertEquals(summary.failed, ['orphans'])
  assertEquals(summary.purged, { posts: 2, notices: 1 })
  assertEquals(summary.files, 2)
  assertEquals(summary.retention, { post_log: 4, audit: 1 })
  assertEquals(summary.swept_at, '2026-10-05T19:07:00.000Z')
  assertEquals(rec.heartbeats.length, 2)
  assertEquals((rec.heartbeats[1]?.purged as { posts: number }).posts, 2)
})

Deno.test('runMaintenance: storage failures are reported, not thrown', async () => {
  const { port: p } = port({ removeFiles: () => Promise.resolve({ removed: 0, failed: 2 }) })
  const summary = await runMaintenance(p, { now: DUE })
  assertEquals(summary.failed, ['files', 'orphans'])
  assertEquals(summary.ok, false)
})

Deno.test('runMaintenance: a failed purge still runs the due sweep', async () => {
  const { port: p } = port({ purgeExpired: () => Promise.reject(new Error('db')) })
  const summary = await runMaintenance(p, { now: DUE })
  assertEquals(summary.failed, ['purge'])
  assertEquals(summary.purged, { posts: 0, notices: 0 })
  assertEquals(summary.orphans, 3)
})

Deno.test('runMaintenance: unreadable previous sweep falls back to the 19:00 UTC hour', async () => {
  const off = await runMaintenance(port({ lastSweptAt: () => Promise.reject(new Error('x')) }).port, { now: NOT_DUE })
  assertEquals([off.orphans, off.ok], [null, true])
  const on = await runMaintenance(port({ lastSweptAt: () => Promise.reject(new Error('x')) }).port, { now: DUE })
  assertEquals(on.orphans, 3)
})

Deno.test('runMaintenance: the first heartbeat failing aborts the run', async () => {
  let purged = false
  const { port: p } = port({
    heartbeat: () => Promise.reject(new Error('db down')),
    purgeExpired: () => {
      purged = true
      return Promise.resolve([])
    },
  })
  await assertRejects(() => runMaintenance(p, { now: NOT_DUE }))
  assertEquals(purged, false)
})

Deno.test('runMaintenance: a failed final heartbeat is reported', async () => {
  let n = 0
  const { port: p } = port({ heartbeat: () => (n++ === 0 ? Promise.resolve() : Promise.reject(new Error('x'))) })
  const summary = await runMaintenance(p, { now: NOT_DUE })
  assertEquals(summary.failed, ['heartbeat'])
  assertEquals(summary.ok, false)
})
