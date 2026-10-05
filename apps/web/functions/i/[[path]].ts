import { serveImage } from '../../edge/image-proxy.ts'

interface Env {
  SUPABASE_URL: string
}

const handle: PagesFunction<Env> = (ctx) => {
  const param = ctx.params.path
  const path = Array.isArray(param) ? param.join('/') : (param ?? '')
  return serveImage(path, {
    supabaseUrl: ctx.env.SUPABASE_URL,
    cache: caches.default,
    fetch: (url) => fetch(url),
    waitUntil: (p) => ctx.waitUntil(p),
    requestUrl: ctx.request.url,
  })
}

export const onRequestGet = handle

// HEAD must not fall through to the SPA fallback (which would answer 200 HTML).
export const onRequestHead: PagesFunction<Env> = async (ctx) => {
  const res = await handle(ctx)
  return new Response(null, { status: res.status, headers: res.headers })
}
