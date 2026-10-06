import { describe, expect, it, vi } from 'vitest'
import { serveImage, type ProxyDeps } from './image-proxy.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
const FILE = '22222222-2222-4222-8222-222222222222'

function deps(upstream: Response | Error): ProxyDeps & { puts: number; fetched: string[] } {
  const store = new Map<string, Response>()
  const d = {
    puts: 0,
    fetched: [] as string[],
    supabaseUrl: 'https://ref.supabase.co/',
    requestUrl: 'https://usmfomo.pages.dev/i/x',
    cache: {
      match: async (req: RequestInfo | URL) => store.get(typeof req === 'string' ? req : (req as Request).url),
      put: async (req: RequestInfo | URL, res: Response) => {
        d.puts++
        store.set(typeof req === 'string' ? req : (req as Request).url, res)
      },
    },
    fetch: async (url: string) => {
      d.fetched.push(url)
      if (upstream instanceof Error) throw upstream
      return upstream.clone()
    },
    waitUntil: (p: Promise<unknown>) => void p,
  }
  return d as never
}

describe('image proxy', () => {
  it('rejects anything but an exact poster path', async () => {
    for (const bad of ['', '../etc/passwd', `${ORG}/../x.webp`, `${ORG}/${FILE}.svg`, `${ORG}/${FILE}.webp?x=1`]) {
      const r = await serveImage(bad, deps(new Response('x')))
      expect(r.status).toBe(404)
    }
  })

  it('fetches from the public bucket, sets its own content type and caches', async () => {
    const d = deps(new Response('img', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    const r = await serveImage(`${ORG}/${FILE}-thumb.webp`, d)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/webp')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(d.fetched[0]).toBe(`https://ref.supabase.co/storage/v1/object/public/posters/${ORG}/${FILE}-thumb.webp`)
    expect(d.puts).toBe(1)
    const again = await serveImage(`${ORG}/${FILE}-thumb.webp`, d)
    expect(again.status).toBe(200)
    expect(d.fetched).toHaveLength(1)
  })

  it('maps upstream 400/404 to 404 and other failures to 502', async () => {
    expect((await serveImage(`${ORG}/${FILE}.jpg`, deps(new Response('', { status: 400 })))).status).toBe(404)
    expect((await serveImage(`${ORG}/${FILE}.jpg`, deps(new Response('', { status: 500 })))).status).toBe(502)
    expect((await serveImage(`${ORG}/${FILE}.jpg`, deps(new Error('down')))).status).toBe(502)
  })

  it('answers a logged 500 when SUPABASE_URL is missing or not a URL, without fetching', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const url of [undefined, '', '  ', 'ref.supabase.co', 'ftp://ref.supabase.co']) {
        const d = deps(new Response('img'))
        d.supabaseUrl = url
        const r = await serveImage(`${ORG}/${FILE}.webp`, d)
        expect(r.status).toBe(500)
        expect(await r.text()).toBe('Misconfigured')
        expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8')
        expect(r.headers.get('cache-control')).toBe('no-store')
        expect(r.headers.get('x-content-type-options')).toBe('nosniff')
        expect(d.fetched).toHaveLength(0)
        expect(d.puts).toBe(0)
      }
      expect(logged).toHaveBeenCalledTimes(5)
      expect(String(logged.mock.calls[0]?.[0])).toContain('SUPABASE_URL')
    } finally {
      logged.mockRestore()
    }
  })

  it('tells a missing SUPABASE_URL apart in the deploy probe (a poster-shaped path that does not exist)', async () => {
    const probe = '00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000.webp'
    const ok = await serveImage(probe, deps(new Response('', { status: 400 })))
    expect([ok.status, ok.headers.get('content-type')]).toEqual([404, 'text/plain; charset=utf-8'])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const d = deps(new Response('', { status: 400 }))
      d.supabaseUrl = undefined
      expect((await serveImage(probe, d)).status).toBe(500)
    } finally {
      logged.mockRestore()
    }
  })

  it('still serves cached files and rejects bad paths while SUPABASE_URL is missing', async () => {
    const d = deps(new Response('img', { status: 200 }))
    expect((await serveImage(`${ORG}/${FILE}.webp`, d)).status).toBe(200)
    d.supabaseUrl = undefined
    expect((await serveImage(`${ORG}/${FILE}.webp`, d)).status).toBe(200)
    expect((await serveImage('nope.webp', d)).status).toBe(404)
    expect(d.fetched).toHaveLength(1)
  })
})
