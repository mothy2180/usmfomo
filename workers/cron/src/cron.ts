// One run of usmfomo-cron (docs/api.md, "Cron Worker"):
//   1. GET site_settings with the publishable key: anonymous API traffic that
//      keeps the free Supabase project from pausing.
//   2. POST the maintenance function with x-cron-secret.
// Both steps always run; if either fails, the run throws so the invocation
// shows as errored in Workers Logs. Logs carry status codes and counts only.

export interface Env {
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  CRON_SECRET: string
}

export const READ_TIMEOUT_MS = 20_000
/** The maintenance run makes a handful of bounded RPC and Storage calls. */
export const MAINTENANCE_TIMEOUT_MS = 120_000

type Fetch = typeof fetch

const REQUIRED: ReadonlyArray<keyof Env> = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'CRON_SECRET']

/** Throws naming the first missing variable, never printing a value. */
export function checkEnv(env: Partial<Env>): asserts env is Env {
  for (const name of REQUIRED) {
    if (typeof env[name] !== 'string' || env[name] === '') throw new Error(`${name} is not set`)
  }
}

function baseUrl(raw: string): string {
  return raw.replace(/\/+$/, '')
}

/** Error description for logs and the thrown error: step, status or error name only. */
function describe(step: string, err: unknown): string {
  if (err instanceof Error && err.message.startsWith(`${step}:`)) return err.message
  const name = err instanceof Error ? err.name : 'Error'
  return `${step}: ${name}`
}

export async function keepAliveRead(env: Env, fetchImpl: Fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${baseUrl(env.SUPABASE_URL)}/rest/v1/site_settings?select=posting_enabled&limit=1`, {
    method: 'GET',
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  })
  await res.body?.cancel()
  if (!res.ok) throw new Error(`site_settings: HTTP ${res.status}`)
}

export type MaintenanceCounts = {
  purged?: { posts?: number; notices?: number }
  files?: number
  orphans?: number | null
  retention?: { post_log?: number; audit?: number } | null
}

function countsOf(text: string): MaintenanceCounts {
  try {
    const body = JSON.parse(text) as MaintenanceCounts | null
    if (!body || typeof body !== 'object') return {}
    return { purged: body.purged, files: body.files, orphans: body.orphans, retention: body.retention }
  } catch {
    return {}
  }
}

export async function callMaintenance(env: Env, fetchImpl: Fetch = fetch): Promise<MaintenanceCounts> {
  const res = await fetchImpl(`${baseUrl(env.SUPABASE_URL)}/functions/v1/maintenance`, {
    method: 'POST',
    headers: { 'x-cron-secret': env.CRON_SECRET, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(MAINTENANCE_TIMEOUT_MS),
  })
  const counts = countsOf(await res.text())
  if (!res.ok) throw new Error(`maintenance: HTTP ${res.status}`)
  return counts
}

export async function runCron(env: Partial<Env>, fetchImpl: Fetch = fetch): Promise<void> {
  checkEnv(env)
  const failures: string[] = []

  try {
    await keepAliveRead(env, fetchImpl)
  } catch (err) {
    failures.push(describe('site_settings', err))
  }

  try {
    const counts = await callMaintenance(env, fetchImpl)
    console.log(JSON.stringify({ event: 'maintenance', ok: true, ...counts }))
  } catch (err) {
    failures.push(describe('maintenance', err))
  }

  if (failures.length > 0) {
    console.error(JSON.stringify({ event: 'cron_failed', failures }))
    throw new Error(`usmfomo-cron failed: ${failures.join('; ')}`)
  }
}
