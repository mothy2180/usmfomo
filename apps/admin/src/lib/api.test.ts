// @vitest-environment node
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AdminApiError, createAdminApi, OWNER_ADMIN_FUNCTION, type Invoke, type InvokeResult } from './api.ts'

const STATUS = {
  last_maintenance_at: '2026-10-05T05:07:00Z',
  last_maintenance_result: { purged: { posts: 1, notices: 0 }, files: 2 },
  live_posts: 6,
  live_notices: '1',
  storage_objects: 12,
  storage_bytes: 123456,
  settings: { posting_enabled: true, public_reads_enabled: true, updated_at: '2026-10-05T02:19:37Z' },
}

const ACCOUNT = {
  user_id: '9f0c2a5e-5b8e-4d55-9a3c-0c1d2e3f4a5b',
  username: 'robotics-club',
  is_owner: false,
  account_active: true,
  org_id: '22222222-2222-4222-8222-222222222222',
  org_name: 'Robotics Club',
  org_slug: 'robotics-club',
  org_type: 'club',
  org_campus: 'engineering',
  org_active: true,
  created_at: '2026-10-01T00:00:00Z',
  last_sign_in_at: null,
  banned_until: null,
  factor_count: 2,
  newest_factor_at: '2026-10-04T00:00:00Z',
  live_posts: 3,
}

const ok = (data: unknown): InvokeResult => ({ data: { ok: true, data }, error: null })

function fakeInvoke(result: InvokeResult | (() => Promise<InvokeResult>)) {
  const fn = vi.fn<Invoke>(async () => (typeof result === 'function' ? result() : result))
  return { fn, api: createAdminApi(fn) }
}

async function failure(promise: Promise<unknown>): Promise<AdminApiError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(AdminApiError)
    return err as AdminApiError
  }
  throw new Error('expected the call to fail')
}

describe('request shaping', () => {
  it('posts { action, ...params } to owner-admin for every action', async () => {
    const userId = ACCOUNT.user_id
    const postId = '0e5b8a1c-1111-4c2d-9e3f-123456789abc'
    const cases: Array<[string, (api: ReturnType<typeof createAdminApi>) => Promise<unknown>, Record<string, unknown>, unknown]> = [
      ['status', (api) => api.status(), { action: 'status' }, STATUS],
      ['list_accounts', (api) => api.listAccounts(), { action: 'list_accounts' }, [ACCOUNT]],
      ['reset_password', (api) => api.resetPassword(userId), { action: 'reset_password', userId }, { password: 'x'.repeat(24) }],
      ['handover', (api) => api.handover(userId), { action: 'handover', userId }, { password: 'y'.repeat(24) }],
      ['set_account_active', (api) => api.setAccountActive(userId, false), { action: 'set_account_active', userId, active: false }, {}],
      ['remove_factors', (api) => api.removeFactors(userId), { action: 'remove_factors', userId }, { removed: 2 }],
      ['delete_account', (api) => api.deleteAccount(userId), { action: 'delete_account', userId }, { removedFiles: 4 }],
      ['delete_post', (api) => api.deletePost(postId), { action: 'delete_post', postId }, { removedFiles: 2 }],
      ['remove_post_image', (api) => api.removePostImage(postId), { action: 'remove_post_image', postId }, { removedFiles: 2 }],
    ]
    for (const [, call, body, data] of cases) {
      const { fn, api } = fakeInvoke(ok(data))
      await call(api)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(OWNER_ADMIN_FUNCTION, { body })
    }
  })

  it('sends exactly the contract fields for create_account and update_org', async () => {
    const created = { userId: ACCOUNT.user_id, orgId: ACCOUNT.org_id, username: 'robotics-club', password: 'P'.repeat(24) }
    const { fn, api } = fakeInvoke(ok(created))
    // Extra properties (here a stray `action` and `password`) must never be forwarded.
    const input = { username: 'robotics-club', orgName: 'Robotics Club', orgSlug: 'robotics-club', type: 'club', campus: 'engineering', action: 'delete_account', password: 'nope' } as const
    await expect(api.createAccount(input)).resolves.toEqual(created)
    expect(fn.mock.calls[0]?.[1]).toEqual({
      body: { action: 'create_account', username: 'robotics-club', orgName: 'Robotics Club', orgSlug: 'robotics-club', type: 'club', campus: 'engineering' },
    })

    const update = fakeInvoke(ok({}))
    await update.api.updateOrg({ orgId: ACCOUNT.org_id, name: 'Robotics', slug: 'robotics', type: 'club', campus: 'main', active: false })
    expect(update.fn.mock.calls[0]?.[1]).toEqual({
      body: { action: 'update_org', orgId: ACCOUNT.org_id, name: 'Robotics', slug: 'robotics', type: 'club', campus: 'main', active: false },
    })
  })
})

describe('responses', () => {
  it('validates and normalises status (counts may be digit strings)', async () => {
    const { api } = fakeInvoke(ok(STATUS))
    const status = await api.status()
    expect(status.live_notices).toBe(1)
    expect(status.storage_bytes).toBe(123456)
    expect(status.settings?.posting_enabled).toBe(true)
  })

  it('parses account rows, including the owner row without an org', async () => {
    const owner = { ...ACCOUNT, user_id: 'a0000000-0000-4000-8000-000000000001', username: 'owner', is_owner: true, org_id: null, org_name: null, org_slug: null, org_type: null, org_campus: null, org_active: null, live_posts: 0 }
    const { api } = fakeInvoke(ok([owner, ACCOUNT]))
    const rows = await api.listAccounts()
    expect(rows.map((r) => r.username)).toEqual(['owner', 'robotics-club'])
    expect(rows[1]?.factor_count).toBe(2)
  })

  it('reports optional counters as null when missing, without failing the action', async () => {
    expect(await fakeInvoke(ok({ removedFiles: 3, pendingFiles: 0 })).api.deletePost('p')).toBe(3)
    expect(await fakeInvoke(ok({})).api.deletePost('p')).toBeNull()
    expect(await fakeInvoke(ok({ removed: 1 })).api.removeFactors('u')).toBe(1)
  })

  it('treats a 2xx without the envelope, or with the wrong shape, as bad_response', async () => {
    expect((await failure(fakeInvoke({ data: 'hello', error: null }).api.status())).code).toBe('bad_response')
    expect((await failure(fakeInvoke({ data: { data: STATUS }, error: null }).api.status())).code).toBe('bad_response')
    // A password-returning action without a password is never "success".
    expect((await failure(fakeInvoke(ok({})).api.resetPassword('u'))).code).toBe('bad_response')
    expect((await failure(fakeInvoke(ok({ ...STATUS, live_posts: 'many' })).api.status())).code).toBe('bad_response')
  })

  it('accepts a JSON string body (no Content-Type) as the envelope', async () => {
    const { api } = fakeInvoke({ data: JSON.stringify({ ok: true, data: { password: 'Z'.repeat(24) } }), error: null })
    await expect(api.handover('u')).resolves.toEqual({ password: 'Z'.repeat(24) })
  })

  it('maps { ok: false, error } to the contract code', async () => {
    const err = await failure(fakeInvoke({ data: { ok: false, error: 'conflict' }, error: null }).api.updateOrg({
      orgId: 'o', name: 'n', slug: 's', type: 'club', campus: 'main', active: true,
    }))
    expect(err.code).toBe('conflict')
    expect(err.action).toBe('update_org')
  })

  it('maps a thrown TypeError from invoke to network', async () => {
    const { api } = fakeInvoke(() => Promise.reject(new TypeError('Failed to fetch')))
    expect((await failure(api.status())).code).toBe('network')
  })
})

// ---------------------------------------------------------------------------
// The real supabase-js client with a fake fetch: request headers and the
// FunctionsHttpError / FunctionsRelayError / FunctionsFetchError mapping.
// ---------------------------------------------------------------------------

const URL_BASE = 'http://127.0.0.1:54321'
const KEY = 'sb_publishable_test_key'

type FetchArgs = [input: string | URL | Request, init?: RequestInit]

function realApi(respond: (...args: FetchArgs) => Promise<Response>) {
  const fetchSpy = vi.fn(respond)
  const client = createClient(URL_BASE, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchSpy as unknown as typeof fetch },
  })
  return { fetchSpy, api: createAdminApi((name, options) => client.functions.invoke(name, options)) }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('with supabase-js functions.invoke', () => {
  it('POSTs JSON to /functions/v1/owner-admin with the apikey header and never the key as a bearer', async () => {
    const { fetchSpy, api } = realApi(async () => json(200, { ok: true, data: STATUS }))
    await api.status()
    const [input, init] = fetchSpy.mock.calls[0]!
    expect(String(input)).toBe(`${URL_BASE}/functions/v1/owner-admin`)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('apikey')).toBe(KEY)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Authorization') ?? '').not.toContain('sb_')
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'status' })
  })

  it.each([
    [403, { ok: false, error: 'forbidden' }, 'forbidden'],
    [403, { ok: false, error: 'mfa_required' }, 'mfa_required'],
    [401, { ok: false, error: 'unauthorized' }, 'unauthorized'],
    [400, { ok: false, error: 'bad_request' }, 'bad_request'],
    [404, { ok: false, error: 'not_found' }, 'not_found'],
    [409, { ok: false, error: 'conflict' }, 'conflict'],
    [500, { ok: false, error: 'internal' }, 'internal'],
  ] as const)('maps HTTP %i %j to %s', async (status, body, code) => {
    const { api } = realApi(async () => json(status, body))
    const err = await failure(api.status())
    expect(err.code).toBe(code)
    expect(err.status).toBe(status)
    expect(err.serverCode).toBeNull()
  })

  it('never reads a bare 403/404 without the contract body as "not the owner" or "not found"', async () => {
    const html = (status: number) => async () => new Response('<html>nope</html>', { status, headers: { 'Content-Type': 'text/html' } })
    expect((await failure(realApi(html(404)).api.status())).code).toBe('unavailable')
    expect((await failure(realApi(html(403)).api.status())).code).toBe('unknown')
    expect((await failure(realApi(html(502)).api.status())).code).toBe('unavailable')
    expect((await failure(realApi(html(500)).api.status())).code).toBe('internal')
    expect((await failure(realApi(html(402)).api.status())).code).toBe('service_restricted')
    expect((await failure(realApi(html(429)).api.status())).code).toBe('rate_limited')
  })

  it('keeps an unknown short server code for reporting, but never free text', async () => {
    const short = await failure(realApi(async () => json(400, { ok: false, error: 'not_implemented' })).api.status())
    expect(short.code).toBe('bad_request')
    expect(short.serverCode).toBe('not_implemented')
    const prose = await failure(realApi(async () => json(500, { ok: false, error: 'Error: password=hunter2 at line 3' })).api.status())
    expect(prose.code).toBe('internal')
    expect(prose.serverCode).toBeNull()
    expect(prose.message).not.toContain('hunter2')
  })

  it('maps relay errors to unavailable and fetch failures to network', async () => {
    const relay = realApi(async () => json(200, { ok: true, data: STATUS }, { 'x-relay-error': 'true' }))
    expect((await failure(relay.api.status())).code).toBe('unavailable')
    const offline = realApi(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect((await failure(offline.api.status())).code).toBe('network')
  })

  it('maps an unparseable 2xx JSON body to bad_response', async () => {
    const { api } = realApi(async () => new Response('{not json', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    expect((await failure(api.status())).code).toBe('bad_response')
  })

  it('returns the generated password of a successful reset', async () => {
    const { api } = realApi(async () => json(200, { ok: true, data: { password: 'FakeForTestsAbcdefghjk23' } }))
    await expect(api.resetPassword(ACCOUNT.user_id)).resolves.toEqual({ password: 'FakeForTestsAbcdefghjk23' })
  })
})
