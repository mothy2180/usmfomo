import { BUCKET } from './config.ts'

/** Exact object-name shape enforced by storage RLS and the posts trigger. */
export const POSTER_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}(-thumb)?\.(webp|jpg)$/

export type ImageMode = 'proxy' | 'direct'

/**
 * URL for a poster or thumbnail. "proxy" goes through the same-origin Pages
 * Function (/i/*), which caches at Cloudflare's edge and keeps Supabase egress
 * low; "direct" is Supabase's public-bucket URL (fallback when the proxy fails).
 */
export function imageUrl(path: string, mode: ImageMode, supabaseUrl: string): string | null {
  if (!POSTER_PATH_RE.test(path)) return null
  if (mode === 'proxy') return `/i/${path}`
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/${path}`
}

/** Object names for a new upload: <org>/<uuid>.<ext> and <org>/<uuid>-thumb.<ext>. */
export function newPosterPaths(orgId: string, ext: 'webp' | 'jpg', uuid: () => string = () => crypto.randomUUID()) {
  const id = uuid()
  return { poster: `${orgId}/${id}.${ext}`, thumb: `${orgId}/${id}-thumb.${ext}` }
}
