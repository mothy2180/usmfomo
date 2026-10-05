import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ACCOUNT_EMAIL_DOMAIN } from './config.ts'
import type { Database } from './database.types.ts'

export type Db = SupabaseClient<Database>

export type ClientOptions = {
  /** Club studio: sessionStorage (shared lab PCs). Public pages: no session. */
  storage?: Storage
  /** Owner console: false keeps the session in memory only. */
  persistSession?: boolean
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
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  })
}

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${ACCOUNT_EMAIL_DOMAIN}`
}
