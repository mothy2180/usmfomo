import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ACCOUNT_EMAIL_DOMAIN } from './config.ts'
import type { Database } from './database.types.ts'

export type Db = SupabaseClient<Database>

export type ClientOptions = {
  /** Club studio: sessionStorage (shared lab PCs). Public pages: no session. */
  storage?: Storage
  /** Owner console: false keeps the session in memory only. */
  persistSession?: boolean
  /** Distinct per client in one page, or supabase-js warns about (and may
   * cross-wire) "Multiple GoTrueClient instances". */
  storageKey?: string
  /** Anonymous clients have nothing to refresh. */
  autoRefreshToken?: boolean
}

/** Browser client. Only ever the sb_publishable_ key — never a secret key. */
export function createBrowserClient(url: string, publishableKey: string, opts: ClientOptions = {}): Db {
  if (/^sb_secret_/.test(publishableKey)) {
    throw new Error('Refusing to use a secret key in the browser')
  }
  return createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: opts.persistSession ?? true,
      storage: opts.storage,
      storageKey: opts.storageKey,
      autoRefreshToken: opts.autoRefreshToken ?? true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  })
}

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${ACCOUNT_EMAIL_DOMAIN}`
}
