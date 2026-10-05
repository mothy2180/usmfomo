import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError, apiErrorFrom, createRestClient } from './rest.ts'

const KEY = 'sb_secret_FakeForTests-0123456789_abcdef'
const TARGET = { url: 'http://127.0.0.1:54321/', key: KEY }

type Seen = { url: string; method: string; headers: Headers; body: string | null }

function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = []
  const fn = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const entry: Seen = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    }
    seen.push(entry)
    return await respond(entry)
  }
  return { fetch: fn as typeof fetch, seen }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function rejectsWith(promise: Promise<unknown>, expected: Partial<ApiError>) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ApiError, String(err))
    for (const [k, v] of Object.entries(expected)) assert.equal(err[k as keyof ApiError], v, k)
    assert.equal(err.message.includes(KEY), false)
    return true
  })
}

describe('createRestClient', () => {
  it('sends the secret key as apikey only, with service prefixes and JSON bodies', async () => {
    const { fetch, seen } = fakeFetch(() => json({ ok: 1 }))
    const client = createRestClient(TARGET, fetch)
    assert.deepEqual(await client.request('rest', 'POST', '/rpc/admin_status', {}), { ok: 1 })
    await client.request('auth', 'GET', '/admin/users/x/factors')
    await client.request('storage', 'DELETE', '/object/posters', { prefixes: ['a'] })

    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), [
      'POST http://127.0.0.1:54321/rest/v1/rpc/admin_status',
      'GET http://127.0.0.1:54321/auth/v1/admin/users/x/factors',
      'DELETE http://127.0.0.1:54321/storage/v1/object/posters',
    ])
    for (const s of seen) {
      assert.equal(s.headers.get('apikey'), KEY)
      assert.equal(s.headers.get('Authorization'), null)
      assert.equal(s.url.includes(KEY), false)
    }
    assert.equal(seen[0]?.body, '{}')
    assert.equal(seen[0]?.headers.get('Content-Type'), 'application/json')
    assert.equal(seen[1]?.body, null)
    assert.equal(seen[1]?.headers.get('Content-Type'), null)
    assert.equal(seen[2]?.body, '{"prefixes":["a"]}')
  })

  it('an empty body is null, a non-JSON body is text', async () => {
    const empty = createRestClient(TARGET, fakeFetch(() => new Response(null, { status: 204 })).fetch)
    assert.equal(await empty.request('rest', 'POST', '/rpc/admin_delete_org', { p_org: 'x' }), null)
    const text = createRestClient(TARGET, fakeFetch(() => new Response('ok')).fetch)
    assert.equal(await text.request('auth', 'GET', '/health'), 'ok')
  })

  it('turns error responses into ApiError with the service code', async () => {
    const auth = createRestClient(
      TARGET,
      fakeFetch(() => json({ code: 422, error_code: 'email_exists', msg: 'already registered' }, 422)).fetch,
    )
    await rejectsWith(auth.request('auth', 'POST', '/admin/users', {}), {
      service: 'auth',
      status: 422,
      code: 'email_exists',
      message: 'already registered',
    })
    const rest = createRestClient(
      TARGET,
      fakeFetch(() =>
        json({ code: '23505', message: 'duplicate key value violates unique constraint "orgs_slug_key"' }, 409)
      ).fetch,
    )
    await rejectsWith(rest.request('rest', 'POST', '/rpc/admin_create_org_account', {}), { status: 409, code: '23505' })
    const storage = createRestClient(
      TARGET,
      fakeFetch(() =>
        json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security' }, 400)
      ).fetch,
    )
    await rejectsWith(storage.request('storage', 'DELETE', '/object/posters', { prefixes: [] }), {
      status: 400,
      code: 'Unauthorized',
    })
  })

  it('network failures and timeouts have status 0 and name only the host', async () => {
    const down = createRestClient(TARGET, fakeFetch(() => Promise.reject(new TypeError('fetch failed'))).fetch)
    await rejectsWith(down.request('rest', 'POST', '/rpc/x', {}), {
      status: 0,
      code: 'network',
      message: 'cannot reach 127.0.0.1:54321',
    })
    const slow = createRestClient(
      TARGET,
      fakeFetch(() => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))).fetch,
      5000,
    )
    await rejectsWith(slow.request('rest', 'POST', '/rpc/x', {}), { status: 0, code: 'timeout' })
  })

  it('every request carries a timeout signal', async () => {
    let signal: AbortSignal | null | undefined
    const recording = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      signal = init?.signal
      return json(null)
    }) as typeof fetch
    await createRestClient(TARGET, recording).request('rest', 'POST', '/rpc/x', {})
    assert.ok(signal instanceof AbortSignal)
  })
})

describe('apiErrorFrom', () => {
  it('falls back to the status and keeps messages on one line', () => {
    assert.equal(apiErrorFrom('rest', 500, null).message, 'HTTP 500')
    assert.equal(apiErrorFrom('auth', 400, { message: 'two\nlines\u0007' }).message, 'two lines')
    assert.equal(apiErrorFrom('auth', 400, { msg: 'x'.repeat(500) }).message.length, 300)
    assert.equal(apiErrorFrom('auth', 403, { code: 'not_admin', message: 'User not allowed' }).code, 'not_admin')
  })
})
