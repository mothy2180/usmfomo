// maintenance — hourly cleanup + keep-alive, called by the usmfomo-cron Worker.
// POST /functions/v1/maintenance with `x-cron-secret: <CRON_SECRET>`; add
// `?sweep=1` to force the daily orphan sweep and retention.
// verify_jwt = false (config.toml): the shared secret is the only credential.
// The published example secret (supabase/.env.example) works on the local
// stack only.
import { createAdminClient } from '../_shared/client.ts'
import { denoEnv, isLocalSupabaseUrl } from '../_shared/env.ts'
import { handleMaintenance } from './handler.ts'
import { createMaintenancePort } from './port.ts'
import type { MaintenancePort } from './run.ts'

const local = isLocalSupabaseUrl(Deno.env.get('SUPABASE_URL'))

let port: MaintenancePort | undefined
const getPort = (): MaintenancePort => (port ??= createMaintenancePort(createAdminClient(denoEnv)))

Deno.serve((req) => handleMaintenance(req, { secret: Deno.env.get('CRON_SECRET'), local, port: getPort }))
