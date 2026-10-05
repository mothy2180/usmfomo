import type { ImageMode } from '@usmfomo/shared/images'

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} (see apps/web/.env.example)`)
  return value
}

export const SUPABASE_URL = required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
export const SUPABASE_PUBLISHABLE_KEY = required(
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
export const TURNSTILE_SITE_KEY = required('VITE_TURNSTILE_SITE_KEY', import.meta.env.VITE_TURNSTILE_SITE_KEY)
export const IMAGE_MODE: ImageMode = import.meta.env.VITE_IMAGE_MODE === 'proxy' ? 'proxy' : 'direct'
/** usmfomo-only contact channel (Gmail/Instagram URL); empty until the owner sets it. */
export const CONTACT_URL: string = import.meta.env.VITE_CONTACT_URL ?? ''
