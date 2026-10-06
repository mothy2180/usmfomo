import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callMaintenance, type Env, keepAliveRead, MAINTENANCE_TIMEOUT_MS, READ_TIMEOUT_MS, runCron } from './cron.ts'
import worker from './index.ts'

const ENV: Env = {
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FakeForTests',
  CRON_SECRET: 'FakeForTests-cron-secret-0123456789abcdef0123456789',
}

const MAINTENANCE_OK = { ok: true, purged: { posts: 2, notices: 1 }, files: 4, orphans: null, retention: null }

type Call = { url: string; init: RequestInit }

function mockFetch(responses: Array<Response | Error>) {
  const calls: Call[] = []
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    const next = responses.shift() ?? new Response('{}')
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A copy of the environment with one variable absent (not just empty). */
function withoutKey(env: Env, name: keyof Env): Partial<Env> {
  const copy: Partial<Env> = { ...env }
  delete copy[name]
  return copy
}

let logs: string[]

beforeEach(() => {
  logs = []
  const record = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  vi.spyOn(console, 'log').mockImplementation(record)
  vi.spyOn(console, 'error').mockImplementation(record)
  vi.spyOn(console, 'warn').mockImplementation(record)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('runCron', () => {
  it('reads site_settings anonymously, then calls maintenance with the cron secret', async () => {
    const { fetch, calls } = mockFetch([json([{ posting_enabled: true }]), json(MAINTENANCE_OK)])
    await runCron(ENV, fetch)

    expect(calls).toHaveLength(2)
    const [read, maint] = calls as [Call, Call]
    expect(read.url).toBe('https://project-ref.supabase.co/rest/v1/site_settings?select=posting_enabled&limit=1')
    expect(read.init.method).toBe('GET')
    const readHeaders = new Headers(read.init.headers)
    expect(readHeaders.get('apikey')).toBe(ENV.SUPABASE_PUBLISHABLE_KEY)
    expect(readHeaders.get('Authorization')).toBeNull()
    expect(readHeaders.get('x-cron-secret')).toBeNull()

    expect(maint.url).toBe('https://project-ref.supabase.co/functions/v1/maintenance')
    expect(maint.init.method).toBe('POST')
    const maintHeaders = new Headers(maint.init.headers)
    expect(maintHeaders.get('x-cron-secret')).toBe(ENV.CRON_SECRET)
    expect(maintHeaders.get('Authorization')).toBeNull()
    expect(maintHeaders.get('apikey')).toBeNull()
  })

  it('puts a timeout on both requests', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const { fetch, calls } = mockFetch([json([]), json(MAINTENANCE_OK)])
    await runCron(ENV, fetch)
    expect(timeout).toHaveBeenNthCalledWith(1, READ_TIMEOUT_MS)
    expect(timeout).toHaveBeenNthCalledWith(2, MAINTENANCE_TIMEOUT_MS)
    for (const call of calls) expect(call.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('logs the maintenance counts', async () => {
    const { fetch } = mockFetch([json([]), json(MAINTENANCE_OK)])
    await runCron(ENV, fetch)
    expect(logs.join('\n')).toContain('"files":4')
    expect(logs.join('\n')).toContain('"posts":2')
  })

  it('throws when the keep-alive read fails, but still runs maintenance', async () => {
    const { fetch, calls } = mockFetch([json({ message: 'paused' }, 503), json(MAINTENANCE_OK)])
    await expect(runCron(ENV, fetch)).rejects.toThrow('site_settings: HTTP 503')
    expect(calls).toHaveLength(2)
  })

  it('throws when maintenance answers non-OK', async () => {
    for (const status of [401, 500, 502]) {
      const { fetch } = mockFetch([json([]), json({ ok: false, error: 'internal' }, status)])
      await expect(runCron(ENV, fetch)).rejects.toThrow(`maintenance: HTTP ${status}`)
    }
  })

  it('throws on network errors and timeouts, naming the step', async () => {
    const timeoutError = new DOMException('The operation timed out.', 'TimeoutError')
    const { fetch } = mockFetch([new TypeError('fetch failed'), timeoutError])
    await expect(runCron(ENV, fetch)).rejects.toThrow('site_settings: TypeError; maintenance: TimeoutError')
  })

  it('never logs or throws the secret', async () => {
    const runs: Array<Array<Response | Error>> = [
      [json([]), json(MAINTENANCE_OK)],
      [json([], 500), json({ ok: false }, 401)],
      [new TypeError(`fetch failed ${ENV.CRON_SECRET}`), new Error(ENV.CRON_SECRET)],
    ]
    for (const responses of runs) {
      const { fetch } = mockFetch(responses)
      let thrown = ''
      try {
        await runCron(ENV, fetch)
      } catch (err) {
        thrown = String(err)
      }
      expect(thrown).not.toContain(ENV.CRON_SECRET)
    }
    expect(logs.length).toBeGreaterThan(0)
    for (const line of logs) {
      expect(line).not.toContain(ENV.CRON_SECRET)
      expect(line).not.toContain(ENV.SUPABASE_PUBLISHABLE_KEY)
    }
  })

  it('refuses to run without the URL or the publishable key, naming only the variable', async () => {
    for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] as const) {
      for (const env of [{ ...ENV, [name]: '' }, withoutKey(ENV, name)]) {
        const { fetch, calls } = mockFetch([])
        await expect(runCron(env, fetch)).rejects.toThrow(`${name} is not set`)
        expect(calls).toHaveLength(0)
      }
    }
  })

  it('still makes the keep-alive read without CRON_SECRET, then fails the run', async () => {
    for (const env of [{ ...ENV, CRON_SECRET: '' }, withoutKey(ENV, 'CRON_SECRET')]) {
      logs = []
      const { fetch, calls } = mockFetch([json([{ posting_enabled: true }])])
      await expect(runCron(env, fetch)).rejects.toThrow('usmfomo-cron failed: maintenance: CRON_SECRET is not set')

      expect(calls).toHaveLength(1)
      const [read] = calls as [Call]
      expect(read.url).toBe('https://project-ref.supabase.co/rest/v1/site_settings?select=posting_enabled&limit=1')
      expect(read.init.method).toBe('GET')
      const headers = new Headers(read.init.headers)
      expect(headers.get('apikey')).toBe(ENV.SUPABASE_PUBLISHABLE_KEY)
      expect(headers.get('x-cron-secret')).toBeNull()
      expect(logs.join('\n')).toContain('"event":"cron_failed","failures":["maintenance: CRON_SECRET is not set"]')
    }
  })

  it('reports a failed read and a missing CRON_SECRET together', async () => {
    const { fetch, calls } = mockFetch([json({ message: 'paused' }, 503)])
    await expect(runCron({ ...ENV, CRON_SECRET: '' }, fetch)).rejects.toThrow(
      'site_settings: HTTP 503; maintenance: CRON_SECRET is not set',
    )
    expect(calls).toHaveLength(1)
  })

  it('accepts a SUPABASE_URL with a trailing slash', async () => {
    const { fetch, calls } = mockFetch([json([]), json(MAINTENANCE_OK)])
    await runCron({ ...ENV, SUPABASE_URL: 'http://127.0.0.1:54321/' }, fetch)
    expect(calls.map((c) => c.url)).toEqual([
      'http://127.0.0.1:54321/rest/v1/site_settings?select=posting_enabled&limit=1',
      'http://127.0.0.1:54321/functions/v1/maintenance',
    ])
  })
})

describe('steps', () => {
  it('keepAliveRead resolves on 200', async () => {
    const { fetch } = mockFetch([json([{ posting_enabled: false }])])
    await expect(keepAliveRead(ENV, fetch)).resolves.toBeUndefined()
  })

  it('callMaintenance returns the counts and tolerates a non-JSON body', async () => {
    expect(await callMaintenance(ENV, mockFetch([json(MAINTENANCE_OK)]).fetch)).toEqual({
      purged: { posts: 2, notices: 1 },
      files: 4,
      orphans: null,
      retention: null,
    })
    expect(await callMaintenance(ENV, mockFetch([new Response('ok')]).fetch)).toEqual({})
  })
})

describe('worker', () => {
  it('has a scheduled handler and no fetch handler', () => {
    expect(typeof worker.scheduled).toBe('function')
    expect('fetch' in worker).toBe(false)
  })

  it('scheduled() runs the cron with global fetch and rejects on failure', async () => {
    const ok = mockFetch([json([]), json(MAINTENANCE_OK)])
    vi.stubGlobal('fetch', ok.fetch)
    const controller = { cron: '7 * * * *', scheduledTime: Date.now(), noRetry: () => {} } as ScheduledController
    await expect(worker.scheduled(controller, ENV)).resolves.toBeUndefined()
    expect(ok.calls).toHaveLength(2)

    const failing = mockFetch([json([]), json({ ok: false }, 401)])
    vi.stubGlobal('fetch', failing.fetch)
    await expect(worker.scheduled(controller, ENV)).rejects.toThrow('maintenance: HTTP 401')
  })

  it('scheduled() keeps the project awake before the Worker secret is set', async () => {
    const readOnly = mockFetch([json([])])
    vi.stubGlobal('fetch', readOnly.fetch)
    const controller = { cron: '7 * * * *', scheduledTime: Date.now(), noRetry: () => {} } as ScheduledController
    const env = { ...ENV, CRON_SECRET: '' }
    await expect(worker.scheduled(controller, env)).rejects.toThrow('maintenance: CRON_SECRET is not set')
    expect(readOnly.calls.map((c) => c.url)).toEqual([
      'https://project-ref.supabase.co/rest/v1/site_settings?select=posting_enabled&limit=1',
    ])
  })
})
