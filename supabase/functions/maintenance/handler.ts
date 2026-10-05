// HTTP layer of the maintenance function. Only `POST` with the right
// x-cron-secret runs anything; every other request gets a bare 401.
import { MIN_SECRET_LENGTH, secretMatches } from '../_shared/crypto.ts'
import { describeError, errorResponse, json } from '../_shared/http.ts'
import { type MaintenancePort, runMaintenance } from './run.ts'

export type MaintenanceDeps = {
  /** CRON_SECRET, read per request. */
  secret: string | undefined
  /** Created lazily, so unauthorised requests never touch configuration. */
  port: () => MaintenancePort
  now?: () => Date
}

export async function handleMaintenance(req: Request, deps: MaintenanceDeps): Promise<Response> {
  const authorised = await secretMatches(req.headers.get('x-cron-secret'), deps.secret)
  if (!authorised || req.method !== 'POST') {
    if (!deps.secret || deps.secret.length < MIN_SECRET_LENGTH) {
      console.error(
        JSON.stringify({
          event: 'maintenance_misconfigured',
          reason: 'CRON_SECRET unset or shorter than 32 characters',
        }),
      )
    }
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
