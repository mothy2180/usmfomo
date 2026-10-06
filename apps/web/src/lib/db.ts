import { imageUrl as buildImageUrl } from '@usmfomo/shared/images'
import { createBrowserClient } from '@usmfomo/shared/supabase'
import { IMAGE_MODE, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../env.ts'

/** Public pages (dashboard, event, organiser): always anonymous, so they show
 * exactly what every student sees. */
export const publicDb = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  persistSession: false,
  autoRefreshToken: false,
  storageKey: 'usmfomo-public',
})

/** Club studio: session kept in sessionStorage, one per tab (shared lab PCs).
 * Closing the tab does NOT end it: reopening the tab or restoring the browser
 * session brings it back. So the studio signs out after 30 minutes without
 * input, and never uses a session whose tab has been idle that long (idle.ts,
 * session.ts). Sign out with { scope: 'local' } so one committee member
 * doesn't sign everyone else out. */
export const studioDb = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  storage: typeof window === 'undefined' ? undefined : window.sessionStorage,
  storageKey: 'usmfomo-studio',
})

/** Poster/thumbnail URL. Falls back to Supabase's own URL (see onImageError). */
export function imageSrc(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  return buildImageUrl(path, IMAGE_MODE, SUPABASE_URL) ?? undefined
}

/** <img onError>: if the same-origin proxy fails (e.g. the Workers daily quota
 * ran out), retry once against Supabase directly. */
export function onImageError(event: { currentTarget: HTMLImageElement }, path: string | null | undefined): void {
  const img = event.currentTarget
  if (!path || img.dataset.fallback === '1') return
  const direct = buildImageUrl(path, 'direct', SUPABASE_URL)
  if (direct) {
    img.dataset.fallback = '1'
    img.src = direct
  }
}
