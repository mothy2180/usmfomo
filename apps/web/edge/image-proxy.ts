// Same-origin poster/thumbnail proxy with Cloudflare's edge cache. It keeps
// Supabase egress (5 + 5 GB/month on Free) to roughly one fetch per file per
// edge location every 6 hours. Only /i/* invokes Functions (public/_routes.json),
// so every other request stays a free, unlimited static-asset request.

export const POSTER_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}(-thumb)?\.(webp|jpg)$/
const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg' }

/** _headers does not apply to Function responses, so set them here. */
export function securityHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  }
}

export type ProxyDeps = {
  /** The SUPABASE_URL Pages variable: undefined when it was never set. */
  supabaseUrl: string | undefined
  cache: Pick<Cache, 'match' | 'put'>
  fetch: (input: string) => Promise<Response>
  waitUntil: (p: Promise<unknown>) => void
  requestUrl: string
}

/** The project URL without trailing slashes, or null if it isn't an http(s) URL. */
function projectUrl(raw: string | undefined): string | null {
  const url = raw?.trim().replace(/\/+$/, '') ?? ''
  try {
    return /^https?:$/.test(new URL(url).protocol) ? url : null
  } catch {
    return null
  }
}

export async function serveImage(path: string, deps: ProxyDeps): Promise<Response> {
  if (!POSTER_PATH_RE.test(path)) {
    return new Response('Not found', { status: 404, headers: { ...securityHeaders('text/plain; charset=utf-8'), 'Cache-Control': 'public, max-age=300' } })
  }
  const cacheKey = new Request(new URL(`/i/${path}`, deps.requestUrl).toString(), { method: 'GET' })
  const hit = await deps.cache.match(cacheKey)
  if (hit) return hit

  // A missing Pages variable: a logged, plain 500 (the deploy smoke test
  // looks for it) instead of an exception and Cloudflare's error page.
  const base = projectUrl(deps.supabaseUrl)
  if (!base) {
    console.error('image proxy misconfigured: SUPABASE_URL is missing or not an http(s) URL')
    return new Response('Misconfigured', { status: 500, headers: { ...securityHeaders('text/plain; charset=utf-8'), 'Cache-Control': 'no-store' } })
  }
  const origin = `${base}/storage/v1/object/public/posters/${path}`
  let upstream: Response
  try {
    upstream = await deps.fetch(origin)
  } catch {
    return new Response('Upstream error', { status: 502, headers: { ...securityHeaders('text/plain; charset=utf-8'), 'Cache-Control': 'no-store' } })
  }
  if (!upstream.ok) {
    const notFound = upstream.status === 400 || upstream.status === 404
    return new Response(notFound ? 'Not found' : 'Upstream error', {
      status: notFound ? 404 : 502,
      headers: { ...securityHeaders('text/plain; charset=utf-8'), 'Cache-Control': notFound ? 'public, max-age=60' : 'no-store' },
    })
  }

  const ext = path.slice(path.lastIndexOf('.') + 1)
  // Our own Content-Type from the (regex-checked) extension, never upstream's.
  const res = new Response(upstream.body, {
    status: 200,
    headers: { ...securityHeaders(TYPES[ext] ?? 'application/octet-stream'), 'Cache-Control': 'public, max-age=3600, s-maxage=21600' },
  })
  deps.waitUntil(deps.cache.put(cacheKey, res.clone()))
  return res
}
