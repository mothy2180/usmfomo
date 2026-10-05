/// <reference types="vite/client" />

// Build-time, public values only. Never put an sb_secret_ key here.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /** Public site for "view event" links; defaults to https://usmfomo.pages.dev. */
  readonly VITE_PUBLIC_SITE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
