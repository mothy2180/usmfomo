// HTTP layer of the maintenance function. Only `POST` with the right
// x-cron-secret runs anything; every other request gets a bare 401.
import { MIN_SECRET_LENGTH, secretMatches } from '../_shared/crypto.ts'
import { describeError, errorResponse, json } from '../_shared/http.ts'
import { type MaintenancePort, runMaintenance } from './run.ts'

/** CRON_SECRET in supabase/.env.example. It is public, so only the local stack may use it. */
export const LOCAL_EXAMPLE_CRON_SECRET = 'local-dev-cron-secret-not-for-production'

export type MaintenanceDeps = {
  /** CRON_SECRET, read per request. */
  secret: string | undefined
  /** True on the local stack only (isLocalSupabaseUrl of SUPABASE_URL). */
  local: boolean
  /** Created lazily, so unauthorised requests never touch configuration. */
  port: () => MaintenancePort
  now?: () => Date
}

/** Why CRON_SECRET cannot be used (logged, never the value), or null when it can. */
export function secretProblem(secret: string | undefined, local: boolean): string | null {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return 'CRON_SECRET unset or shorter than 32 characters'
  if (!local && secret === LOCAL_EXAMPLE_CRON_SECRET) {
    return 'CRON_SECRET is the published example from supabase/.env.example'
  }
  return null
}

export async function handleMaintenance(req: Request, deps: MaintenanceDeps): Promise<Response> {
  const problem = secretProblem(deps.secret, deps.local)
  const authorised = problem === null && await secretMatches(req.headers.get('x-cron-secret'), deps.secret)
  if (!authorised || req.method !== 'POST') {
    if (problem) console.error(JSON.stringify({ event: 'maintenance_misconfigured', reason: problem }))
    return errorResponse('unauthorized')
  }

  const force = new URL(req.url).searchParams.get('sweep') === '1'
  let summary
  try {
    summary = await runMaintenance(deps.port(), { now: deps.now?.() ?? new Date(), force })
  } catch (err) {
    console.error(JSON.stringify({ event: 'maintenance_failed', step: 'heartbeat', error: describeError(err) }))
    return errorResponse('internal')
  }

  console.log(JSON.stringify({
    event: 'maintenance',
    ok: summary.ok,
    purged_posts: summary.purged.posts,
    purged_notices: summary.purged.notices,
    files: summary.files,
    orphans: summary.orphans,
    retention_post_log: summary.retention?.post_log ?? null,
    retention_audit: summary.retention?.audit ?? null,
    failed: summary.failed,
  }))

  const counts = {
    purged: summary.purged,
    files: summary.files,
    orphans: summary.orphans,
    retention: summary.retention,
  }
  return summary.ok
    ? json(200, { ok: true, ...counts })
    : json(500, { ok: false, error: 'internal', ...counts, failed: summary.failed })
}
