import { publicSiteUrl } from './lib/siteUrl.ts'

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} (see apps/admin/.env.example)`)
  return value
}

export const SUPABASE_URL = required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
/** Publishable key only; createBrowserClient refuses an sb_secret_ key. */
export const SUPABASE_PUBLISHABLE_KEY = required(
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
export const TURNSTILE_SITE_KEY = required('VITE_TURNSTILE_SITE_KEY', import.meta.env.VITE_TURNSTILE_SITE_KEY)
/** Public site, for links to event pages and the club login. */
export const PUBLIC_SITE_URL = publicSiteUrl(import.meta.env.VITE_PUBLIC_SITE_URL)
