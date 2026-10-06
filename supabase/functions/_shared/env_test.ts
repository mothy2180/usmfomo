import { assertEquals, assertThrows } from '@std/assert'
import { apikeyOnlyFetch } from './client.ts'
import { isLocalSupabaseUrl, parseSecretKeys, requireEnv } from './env.ts'

const KEY = 'sb_secret_FakeForTests00000000000000000'
const OTHER_KEY = 'sb_secret_FakeForTests11111111111111111'

Deno.test('parseSecretKeys: returns .default, also when other keys exist', () => {
  assertEquals(parseSecretKeys(JSON.stringify({ default: KEY, other: OTHER_KEY })), KEY)
})

Deno.test('parseSecretKeys: without "default", the only secret key (a replacement under another name)', () => {
  assertEquals(parseSecretKeys(JSON.stringify({ 'default-2026': KEY })), KEY)
  assertEquals(parseSecretKeys(JSON.stringify({ rotated: KEY, note: 'sb_publishable_abc', n: 1 })), KEY)
})

Deno.test('parseSecretKeys: refuses missing, malformed, ambiguous or non-secret values without echoing them', () => {
  const cases: Array<[string | undefined, string]> = [
    [undefined, 'SUPABASE_SECRET_KEYS is not set'],
    ['', 'SUPABASE_SECRET_KEYS is not set'],
    ['{not json', 'not valid JSON'],
    ['null', 'has no secret key'],
    ['[]', 'has no secret key'],
    [JSON.stringify([KEY]), 'has no secret key'],
    [JSON.stringify({ owner: 'sb_publishable_abc' }), 'has no secret key'],
    [JSON.stringify({ a: KEY, b: OTHER_KEY }), 'several secret keys and none is named "default"'],
    // A "default" that is not a secret key is refused, not replaced by another key.
    [JSON.stringify({ default: 'sb_publishable_abc', other: KEY }), 'no "default" secret key'],
    [JSON.stringify({ default: 'sb_publishable_abc' }), 'no "default" secret key'],
    [JSON.stringify({ default: 'eyJhbGciOiJIUzI1NiJ9.e30.x' }), 'no "default" secret key'],
  ]
  for (const [raw, message] of cases) {
    const err = assertThrows(() => parseSecretKeys(raw), Error, message)
    assertEquals(err.message.includes('sb_'), false)
  }
})

Deno.test('isLocalSupabaseUrl: the local gateway only, never a hosted project', () => {
  for (const url of ['http://kong:8000', 'http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321']) {
    assertEquals(isLocalSupabaseUrl(url), true, url)
  }
  for (
    const url of [
      undefined,
      '',
      'not a url',
      'https://abcdefghijklmnop.supabase.co',
      'http://abcdefghijklmnop.supabase.co',
      'https://localhost:54321',
      'http://kong.example.com',
    ]
  ) {
    assertEquals(isLocalSupabaseUrl(url), false, String(url))
  }
})

Deno.test('requireEnv: names the variable, never a value', () => {
  assertEquals(requireEnv((n) => (n === 'A' ? 'value' : undefined), 'A'), 'value')
  assertThrows(() => requireEnv(() => undefined, 'SUPABASE_URL'), Error, 'SUPABASE_URL is not set')
  assertThrows(() => requireEnv(() => '', 'SUPABASE_URL'), Error, 'SUPABASE_URL is not set')
})

function recordingFetch() {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const base = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init })
    return Promise.resolve(new Response('{}'))
  }) as typeof fetch
  return { base, calls }
}

Deno.test('apikeyOnlyFetch: drops an sb_ key from Authorization, keeps apikey', async () => {
  const { base, calls } = recordingFetch()
  await apikeyOnlyFetch(base)('http://kong:8000/rest/v1/rpc/x', {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  const headers = new Headers(calls[0].init?.headers)
  assertEquals(headers.get('apikey'), KEY)
  assertEquals(headers.get('Authorization'), null)
  assertEquals(calls[0].init?.method, 'POST')
})

Deno.test('apikeyOnlyFetch: keeps a user access token', async () => {
  const { base, calls } = recordingFetch()
  await apikeyOnlyFetch(base)('http://kong:8000/auth/v1/user', {
    headers: { apikey: KEY, Authorization: 'Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln' },
  })
  const headers = new Headers(calls[0].init?.headers)
  assertEquals(headers.get('Authorization'), 'Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln')
})

Deno.test('apikeyOnlyFetch: adds a timeout signal and respects the caller signal', async () => {
  const { base, calls } = recordingFetch()
  const fetchWithTimeout = apikeyOnlyFetch(base, 5)
  await fetchWithTimeout('http://kong:8000/x')
  const signal = calls[0].init?.signal
  assertEquals(signal instanceof AbortSignal, true)
  await new Promise((r) => setTimeout(r, 20))
  assertEquals(signal?.aborted, true)

  const caller = new AbortController()
  await apikeyOnlyFetch(base, 60_000)('http://kong:8000/y', { signal: caller.signal })
  caller.abort()
  assertEquals(calls[1].init?.signal?.aborted, true)
})
