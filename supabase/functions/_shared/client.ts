// Service client for the Edge Functions: SUPABASE_URL plus the secret key
// from SUPABASE_SECRET_KEYS.default (never SUPABASE_SERVICE_ROLE_KEY).
import { createClient, type SupabaseClient } from './deps.ts'
import { type EnvReader, parseSecretKeys, requireEnv } from './env.ts'

export type AdminClient = SupabaseClient

/** Per-request limit, so one stuck call cannot use up the function's wall-clock budget. */
export const REQUEST_TIMEOUT_MS = 15_000

/**
 * New API keys belong in the `apikey` header only (docs/api.md). supabase-js
 * also copies its key into `Authorization: Bearer` when it has no user
 * session; this wrapper drops that copy, so an sb_ key is never sent as a
 * bearer token. A user's own access token (auth.getUser(jwt)) is kept.
 * Every request also gets a timeout.
 */
export function apikeyOnlyFetch(base: typeof fetch = fetch, timeoutMs = REQUEST_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (/^bearer\s+sb_/i.test(headers.get('Authorization') ?? '')) headers.delete('Authorization')
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return base(input, { ...init, headers, signal })
  }
}

export function createAdminClient(read: EnvReader): AdminClient {
  const url = requireEnv(read, 'SUPABASE_URL')
  const key = parseSecretKeys(read('SUPABASE_SECRET_KEYS'))
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: apikeyOnlyFetch() },
  })
}
