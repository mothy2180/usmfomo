// maintenance — hourly cleanup + keep-alive, called by the usmfomo-cron Worker.
// POST /functions/v1/maintenance with `x-cron-secret: <CRON_SECRET>`; add
// `?sweep=1` to force the daily orphan sweep and retention.
// verify_jwt = false (config.toml): the shared secret is the only credential.
import { createAdminClient } from '../_shared/client.ts'
import { denoEnv } from '../_shared/env.ts'
import { handleMaintenance } from './handler.ts'
import { createMaintenancePort } from './port.ts'
import type { MaintenancePort } from './run.ts'

let port: MaintenancePort | undefined
const getPort = (): MaintenancePort => (port ??= createMaintenancePort(createAdminClient(denoEnv)))

Deno.serve((req) => handleMaintenance(req, { secret: Deno.env.get('CRON_SECRET'), port: getPort }))
