// The maintenance heartbeat's last result (admin_status().last_maintenance_result,
// written by the maintenance function, docs/api.md). It is plain JSON from the
// database, so every field is read defensively. The heartbeat time moves at the
// start of every run, even one that then fails, so only `ok` and `failed` show
// whether the clean-up actually worked.

const HOUR = 60 * 60_000

/** The daily sweep runs on the first run after 03:00 MYT; a sweep older than
 * this missed at least one day. */
export const SWEEP_STALE_MS = 26 * HOUR

export type MaintenanceResult = {
  /** false when a step failed; null when the result doesn't say. */
  ok: boolean | null
  /** Steps that failed in that run, e.g. ['files', 'orphans']. */
  failed: string[]
  posts: number | null
  notices: number | null
  files: number | null
  orphans: number | null
  /** When the daily sweep last completed, or null. */
  sweptAt: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readMaintenanceResult(value: unknown): MaintenanceResult | null {
  if (!isRecord(value)) return null
  const purged = isRecord(value.purged) ? value.purged : {}
  return {
    ok: typeof value.ok === 'boolean' ? value.ok : null,
    failed: Array.isArray(value.failed) ? value.failed.filter((s): s is string => typeof s === 'string') : [],
    posts: num(purged.posts),
    notices: num(purged.notices),
    files: num(value.files),
    orphans: num(value.orphans),
    sweptAt: typeof value.swept_at === 'string' ? value.swept_at : null,
  }
}

/** The run reported a failure: ok is false, or a step is listed as failed. */
export function runFailed(result: MaintenanceResult | null): boolean {
  return result !== null && (result.ok === false || result.failed.length > 0)
}

const STEP_LABELS: Record<string, string> = {
  purge: 'purging ended posts and notices',
  files: 'deleting the poster files of purged posts',
  orphans: 'the daily sweep of orphaned poster files',
  retention: 'the daily log clean-up',
  heartbeat: 'saving the result',
}

/** Plain-English names of failed steps; an unknown step keeps its own name. */
export function failedStepLabels(steps: readonly string[]): string[] {
  return steps.map((step) => STEP_LABELS[step] ?? step)
}

/** True when the last completed sweep is more than 26 hours old. No date means
 * unknown, not overdue: a failed sweep already marks the run as failed. */
export function isSweepOverdue(sweptAt: string | null, now: Date): boolean {
  if (!sweptAt) return false
  const at = Date.parse(sweptAt)
  if (Number.isNaN(at)) return false
  return now.getTime() - at > SWEEP_STALE_MS
}
