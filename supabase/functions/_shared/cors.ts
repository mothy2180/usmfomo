// CORS for owner-admin: only the origins listed in ADMIN_ORIGINS (comma
// separated, e.g. "https://usmfomo-admin.pages.dev,http://127.0.0.1:5174").
// A request from any other origin, or without an Origin header, is refused.

/** Every header supabase-js sends (kept in sync with @supabase/supabase-js/cors). */
export const ALLOWED_HEADERS = [
  'authorization',
  'x-client-info',
  'apikey',
  'content-type',
  'x-retry-count',
  'traceparent',
  'tracestate',
  'baggage',
].join(', ')

export const ALLOWED_METHODS = 'POST, OPTIONS'
export const PREFLIGHT_MAX_AGE = '600'

/** Parses ADMIN_ORIGINS. Entries that are not a bare http(s) origin are ignored. */
export function parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
  const origins = new Set<string>()
  for (const part of (raw ?? '').split(',')) {
    const value = part.trim()
    if (!value) continue
    let url: URL
    try {
      url = new URL(value)
    } catch {
      continue
    }
    const bare = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
    if ((url.protocol === 'https:' || url.protocol === 'http:') && bare) origins.add(url.origin)
  }
  return origins
}

/** The browser's Origin header is already a serialised origin; compare it exactly. */
export function isAllowedOrigin(origin: string | null, allowed: ReadonlySet<string>): origin is string {
  return origin !== null && origin !== 'null' && allowed.has(origin)
}

/** Headers for an actual (non-preflight) response to an allowed origin. */
export function corsHeaders(origin: string): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  })
}

/** Answer to an OPTIONS preflight from an allowed origin. */
export function preflightResponse(origin: string): Response {
  const headers = corsHeaders(origin)
  headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  headers.set('Access-Control-Max-Age', PREFLIGHT_MAX_AGE)
  headers.set('Cache-Control', 'no-store')
  return new Response(null, { status: 204, headers })
}
