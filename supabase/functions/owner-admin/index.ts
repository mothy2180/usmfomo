// owner-admin — account and moderation actions for the owner console.
// POST /functions/v1/owner-admin with `{ "action": ..., ...params }` from an
// aal2 owner session (docs/api.md). verify_jwt = false (config.toml): the
// session is verified in code (authorise.ts), CORS only allows ADMIN_ORIGINS.
import { createAdminClient } from '../_shared/client.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { denoEnv } from '../_shared/env.ts'
import { handleOwnerAdmin } from './handler.ts'
import { createOwnerAdminPort } from './port.ts'
import type { OwnerAdminPort } from './types.ts'

const allowedOrigins = parseAllowedOrigins(Deno.env.get('ADMIN_ORIGINS'))
if (allowedOrigins.size === 0) {
  console.error(JSON.stringify({ event: 'owner_admin_misconfigured', reason: 'ADMIN_ORIGINS has no valid origin' }))
}

let port: OwnerAdminPort | undefined
const getPort = (): OwnerAdminPort => (port ??= createOwnerAdminPort(createAdminClient(denoEnv)))

Deno.serve((req) => handleOwnerAdmin(req, { allowedOrigins, port: getPort }))
