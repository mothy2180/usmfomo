import { assertEquals } from '@std/assert'
import { handleMaintenance } from './handler.ts'
import type { MaintenancePort } from './run.ts'

const SECRET = 'local-dev-cron-secret-not-for-production'

function fakePort(overrides: Partial<MaintenancePort> = {}): MaintenancePort {
  return {
    heartbeat: () => Promise.resolve(),
    purgeExpired: () =>
      Promise.resolve([{ kind: 'post', id: 'p', poster_path: 'o/a.webp', thumb_path: 'o/a-thumb.webp' }]),
    lastSweptAt: () => Promise.resolve(new Date().toISOString()),
    orphans: () => Promise.resolve([]),
    retention: () => Promise.resolve({ post_log: 0, audit: 0 }),
    removeFiles: (paths) => Promise.resolve({ removed: paths.filter((p) => p).length, failed: 0 }),
    ...overrides,
  }
}

async function call(
  init: { secret?: string | null; method?: string; query?: string },
  port = fakePort(),
  secret: string | undefined = SECRET,
) {
  const headers = new Headers()
  if (init.secret !== null) headers.set('x-cron-secret', init.secret ?? SECRET)
  const req = new Request(`http://localhost/functions/v1/maintenance${init.query ?? ''}`, {
    method: init.method ?? 'POST',
    headers,
  })
  let created = 0
  const res = await handleMaintenance(req, { secret, port: () => (created++, port) })
  return { res, body: await res.json(), created }
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { log, error } = console
  console.log = () => {}
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.log = log
    console.error = error
  }
}

Deno.test('401 without, or with a wrong, secret; nothing runs', async () => {
  for (const secret of [null, '', 'wrong', SECRET + 'x', SECRET.toUpperCase()]) {
    const { res, body, created } = await call({ secret })
    assertEquals(res.status, 401)
    assertEquals(body, { ok: false, error: 'unauthorized' })
    assertEquals(created, 0)
  }
})

Deno.test('401 for other methods even with the right secret', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const { res, created } = await call({ method })
    assertEquals(res.status, 401)
    assertEquals(created, 0)
  }
})

Deno.test('401 when CRON_SECRET is unset or too short', async () => {
  await quiet(async () => {
    assertEquals((await call({ secret: '' }, fakePort(), undefined)).res.status, 401)
    assertEquals((await call({ secret: 'short' }, fakePort(), 'short')).res.status, 401)
  })
})

Deno.test('200 with the counts', async () => {
  const { res, body } = await quiet(() => call({}))
  assertEquals(res.status, 200)
  assertEquals(body, { ok: true, purged: { posts: 1, notices: 0 }, files: 2, orphans: null, retention: null })
  assertEquals(res.headers.get('Cache-Control'), 'no-store')
})

Deno.test('?sweep=1 forces the daily sweep', async () => {
  const { body } = await quiet(() => call({ query: '?sweep=1' }))
  assertEquals(body.orphans, 0)
  assertEquals(body.retention, { post_log: 0, audit: 0 })
})

Deno.test('500 with the counts so far when a later step fails', async () => {
  const { res, body } = await quiet(() =>
    call({ query: '?sweep=1' }, fakePort({ retention: () => Promise.reject(new Error('x')) }))
  )
  assertEquals(res.status, 500)
  assertEquals(body.ok, false)
  assertEquals(body.error, 'internal')
  assertEquals(body.purged, { posts: 1, notices: 0 })
  assertEquals(body.files, 2)
  assertEquals(body.failed, ['retention'])
})

Deno.test('500 when the database is unreachable', async () => {
  const { res, body } = await quiet(() => call({}, fakePort({ heartbeat: () => Promise.reject(new Error('down')) })))
  assertEquals(res.status, 500)
  assertEquals(body, { ok: false, error: 'internal' })
})
