// createMaintenancePort against the real supabase-js client with a stubbed
// fetch: which RPC each step calls, and that the jsonb lists of 0051 come
// back whole, even when longer than PostgREST's 100-row cap.
import { assertEquals } from '@std/assert'
import { createAdminClient } from '../_shared/client.ts'
import { createMaintenancePort } from './port.ts'
import type { MaintenancePort, PurgedRow } from './run.ts'

const KEY = 'sb_secret_FakeForTests00000000000000000'

type Handler = (path: string, body: unknown) => Response

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function withPort(handler: Handler, fn: (port: MaintenancePort) => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    assertEquals(req.headers.get('apikey'), KEY)
    const path = new URL(req.url).pathname
    const text = await req.text()
    seen.push(`${req.method} ${path} ${text}`)
    return handler(path, text ? JSON.parse(text) : null)
  }) as typeof fetch
  try {
    const env: Record<string, string> = {
      SUPABASE_URL: 'http://kong.test',
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: KEY }),
    }
    await fn(createMaintenancePort(createAdminClient((name) => env[name])))
  } finally {
    globalThis.fetch = original
  }
  return seen
}

Deno.test('purgeExpired and orphans: one jsonb array each, longer than 100 entries', async () => {
  const purged: PurgedRow[] = [
    ...Array.from(
      { length: 100 },
      (_, i): PurgedRow => ({ kind: 'post', id: `p${i}`, poster_path: null, thumb_path: null }),
    ),
    { kind: 'notice', id: 'n1', poster_path: null, thumb_path: null },
  ]
  const orphans = Array.from({ length: 150 }, (_, i) => `o/${i}.webp`)
  const seen = await withPort((path) => {
    if (path === '/rest/v1/rpc/maint_purge_expired') return json(purged)
    if (path === '/rest/v1/rpc/maint_orphans') return json(orphans)
    return json({ msg: path }, 418)
  }, async (port) => {
    assertEquals(await port.purgeExpired(100), purged)
    assertEquals(await port.orphans(), orphans)
  })
  assertEquals(seen, ['POST /rest/v1/rpc/maint_purge_expired {"p_limit":100}', 'POST /rest/v1/rpc/maint_orphans {}'])
})

Deno.test('heartbeat, lastSweptAt and retention', async () => {
  const seen = await withPort((path) => {
    switch (path) {
      case '/rest/v1/rpc/maint_heartbeat':
        return json('2026-10-06T00:00:00+00:00')
      case '/rest/v1/rpc/admin_status':
        return json({ last_maintenance_result: { swept_at: '2026-10-05T19:07:00.000Z' } })
      case '/rest/v1/rpc/maint_retention':
        return json({ post_log: 2, audit: 0 })
      default:
        return json({ msg: path }, 418)
    }
  }, async (port) => {
    await port.heartbeat({ ok: true })
    assertEquals(await port.lastSweptAt(), '2026-10-05T19:07:00.000Z')
    assertEquals(await port.retention(), { post_log: 2, audit: 0 })
  })
  assertEquals(seen[0], 'POST /rest/v1/rpc/maint_heartbeat {"p_result":{"ok":true}}')
})
