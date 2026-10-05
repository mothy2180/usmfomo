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
  supabaseUrl: string
  cache: Pick<Cache, 'match' | 'put'>
  fetch: (input: string) => Promise<Response>
  waitUntil: (p: Promise<unknown>) => void
  requestUrl: string
}

export async function serveImage(path: string, deps: ProxyDeps): Promise<Response> {
  if (!POSTER_PATH_RE.test(path)) {
    return new Response('Not found', { status: 404, headers: { ...securityHeaders('text/plain; charset=utf-8'), 'Cache-Control': 'public, max-age=300' } })
  }
  const cacheKey = new Request(new URL(`/i/${path}`, deps.requestUrl).toString(), { method: 'GET' })
  const hit = await deps.cache.match(cacheKey)
  if (hit) return hit

  const origin = `${deps.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/posters/${path}`
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
