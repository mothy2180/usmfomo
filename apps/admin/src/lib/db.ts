import { createBrowserClient } from '@usmfomo/shared/supabase'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../env.ts'
import { createAdminApi } from './api.ts'

/** The owner session lives in memory only (persistSession: false): it is never
 * written to localStorage or sessionStorage, so a reload or a closed tab means
 * signing in again. This origin holds an aal2 owner token, so nothing about it
 * may outlive the page. */
export const ownerDb = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { persistSession: false })

/** owner-admin Edge Function, called with the owner's access token. */
export const adminApi = createAdminApi((name, options) => ownerDb.functions.invoke(name, options))
