// One maintenance run (docs/api.md, "maintenance Edge Function"):
//   1. heartbeat (keep-alive write)
//   2. purge up to 100 expired posts + notices, then remove their poster files
//   3. once a day (first run after 03:00 MYT = 19:00 UTC, or forced):
//      orphan sweep + retention
//   4. final heartbeat with the counts
// Idempotent and bounded: ≤ 100 rows of each kind, ≤ 200 purge files and
// ≤ 500 orphan files per run (each list is one jsonb array, which PostgREST's
// 100-row cap does not cut). A failing step never discards earlier results.
import type { RemoveResult } from '../_shared/storage.ts'
import { describeError } from '../_shared/http.ts'

export const PURGE_LIMIT = 100
/** 03:00 in Malaysia (UTC+8, no daylight saving). */
export const SWEEP_HOUR_UTC = 19
const DAY_MS = 24 * 60 * 60 * 1000

export type PurgedRow = {
  kind: 'post' | 'notice'
  id: string
  poster_path: string | null
  thumb_path: string | null
}

export type Retention = { post_log: number; audit: number }

/** Side effects of a run (secret-key RPCs and Storage), injected for tests. */
export interface MaintenancePort {
  heartbeat(result: Record<string, unknown> | null): Promise<void>
  purgeExpired(limit: number): Promise<PurgedRow[]>
  /** `swept_at` recorded by the previous run, or null when there is none. */
  lastSweptAt(): Promise<string | null>
  orphans(): Promise<string[]>
  retention(): Promise<Retention>
  removeFiles(paths: ReadonlyArray<string | null>): Promise<RemoveResult>
}

export type FailedStep = 'purge' | 'files' | 'orphans' | 'retention' | 'heartbeat'

export type MaintenanceSummary = {
  ok: boolean
  purged: { posts: number; notices: number }
  files: number
  /** Orphan files removed, or null when the daily sweep did not run. */
  orphans: number | null
  /** Rows deleted by retention, or null when the daily sweep did not run. */
  retention: Retention | null
  failed: FailedStep[]
  at: string
  swept_at: string | null
}

/** The most recent 19:00 UTC at or before `now`, in epoch milliseconds. */
export function lastSweepBoundary(now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SWEEP_HOUR_UTC)
  return today <= now.getTime() ? today : today - DAY_MS
}

/**
 * Whether this run does the daily sweep. `lastSweptAt` is the previous run's
 * record: null means never swept; undefined means it could not be read, in
 * which case only a run in the 19:00 UTC hour sweeps.
 */
export function shouldSweep(now: Date, lastSweptAt: string | null | undefined, force: boolean): boolean {
  if (force) return true
  if (lastSweptAt === undefined) return now.getUTCHours() === SWEEP_HOUR_UTC
  if (lastSweptAt === null) return true
  const last = Date.parse(lastSweptAt)
  return Number.isNaN(last) || last < lastSweepBoundary(now)
}

function logFailure(step: FailedStep | 'last_swept_at', err: unknown): void {
  console.error(JSON.stringify({ event: 'maintenance_step_failed', step, error: describeError(err) }))
}

/**
 * Runs steps 1–4. Throws only when the first heartbeat fails (the database is
 * unreachable, so nothing else can work); every later failure is recorded in
 * `failed` and the remaining steps still run.
 */
export async function runMaintenance(
  port: MaintenancePort,
  opts: { now?: Date; force?: boolean } = {},
): Promise<MaintenanceSummary> {
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const failed: FailedStep[] = []

  // 1. Keep-alive write. p_result null keeps the previous result until step 4.
  await port.heartbeat(null)

  // 2. Expired rows are deleted first (only while still expired); their files follow.
  const purged = { posts: 0, notices: 0 }
  let files = 0
  try {
    const rows = await port.purgeExpired(PURGE_LIMIT)
    purged.posts = rows.filter((r) => r.kind === 'post').length
    purged.notices = rows.filter((r) => r.kind === 'notice').length
    const removal = await port.removeFiles(rows.flatMap((r) => [r.poster_path, r.thumb_path]))
    files = removal.removed
    if (removal.failed > 0) failed.push('files')
  } catch (err) {
    failed.push('purge')
    logFailure('purge', err)
  }

  // 3. Daily orphan sweep + retention.
  let previous: string | null | undefined
  try {
    previous = await port.lastSweptAt()
  } catch (err) {
    previous = undefined
    logFailure('last_swept_at', err)
  }
  let orphans: number | null = null
  let retention: Retention | null = null
  let sweptAt = previous ?? null
  if (shouldSweep(now, previous, opts.force ?? false)) {
    let sweepOk = true
    try {
      const removal = await port.removeFiles(await port.orphans())
      orphans = removal.removed
      if (removal.failed > 0) {
        sweepOk = false
        failed.push('orphans')
      }
    } catch (err) {
      sweepOk = false
      failed.push('orphans')
      logFailure('orphans', err)
    }
    try {
      retention = await port.retention()
    } catch (err) {
      sweepOk = false
      failed.push('retention')
      logFailure('retention', err)
    }
    // A sweep that failed is retried by the next run.
    if (sweepOk) sweptAt = at
  }

  const summary: MaintenanceSummary = {
    ok: failed.length === 0,
    purged,
    files,
    orphans,
    retention,
    failed,
    at,
    swept_at: sweptAt,
  }

  // 4. Final heartbeat with counts only.
  try {
    await port.heartbeat({ ...summary })
  } catch (err) {
    summary.failed = [...failed, 'heartbeat']
    summary.ok = false
    logFailure('heartbeat', err)
  }
  return summary
}
