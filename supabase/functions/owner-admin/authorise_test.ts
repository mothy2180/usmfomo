import { assertEquals, assertRejects } from '@std/assert'
import { HttpError } from '../_shared/http.ts'
import { authorise, bearerToken } from './authorise.ts'
import { CLUB_ID, fakePort, OWNER_ID, TOKEN } from './testing.ts'

function request(authorization?: string): Request {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('Authorization', authorization)
  return new Request('http://localhost/owner-admin', { method: 'POST', headers })
}

async function failsWith(promise: Promise<unknown>, code: string) {
  const err = await assertRejects(() => promise, HttpError)
  assertEquals(err.code, code)
}

Deno.test('bearerToken: only a JWT-shaped bearer token', () => {
  assertEquals(bearerToken(`Bearer ${TOKEN}`), TOKEN)
  assertEquals(bearerToken(`bearer ${TOKEN}`), TOKEN)
  assertEquals(bearerToken(`  Bearer   ${TOKEN}  `), TOKEN)
  for (
    const bad of [
      null,
      '',
      'Bearer',
      `Basic ${TOKEN}`,
      'Bearer sb_publishable_abc',
      'Bearer sb_secret_abc',
      'Bearer a.b',
      'Bearer a.b.c.d',
      `Bearer ${TOKEN} extra`,
      TOKEN,
    ]
  ) {
    assertEquals(bearerToken(bad), null, String(bad))
  }
})

Deno.test('authorise: an aal2 owner passes, checks run in order', async () => {
  const { port, ops } = fakePort()
  assertEquals(await authorise(request(`Bearer ${TOKEN}`), port), { userId: OWNER_ID })
  assertEquals(ops(), ['verifyToken', 'sessionUserId', 'isOwner'])
})

Deno.test('authorise: no or malformed token is 401 before any lookup', async () => {
  const { port, ops } = fakePort()
  await failsWith(authorise(request(), port), 'unauthorized')
  await failsWith(authorise(request('Bearer sb_publishable_abc'), port), 'unauthorized')
  assertEquals(ops(), [])
})

Deno.test('authorise: invalid signature or expired token is 401', async () => {
  const { port } = fakePort({ verifyToken: () => Promise.reject(new HttpError('unauthorized')) })
  await failsWith(authorise(request(`Bearer ${TOKEN}`), port), 'unauthorized')
})

Deno.test('authorise: only role authenticated with a uuid subject', async () => {
  for (
    const claims of [
      { sub: OWNER_ID, role: 'anon', aal: 'aal2' },
      { sub: OWNER_ID, role: 'service_role', aal: 'aal2' },
      { sub: 'not-a-uuid', role: 'authenticated', aal: 'aal2' },
      { sub: undefined, role: 'authenticated', aal: 'aal2' },
    ]
  ) {
    const { port } = fakePort({ verifyToken: () => Promise.resolve(claims) })
    await failsWith(authorise(request(`Bearer ${TOKEN}`), port), 'unauthorized')
  }
})

Deno.test('authorise: aal1 is 403 mfa_required before the session lookup', async () => {
  for (const aal of ['aal1', undefined, 'AAL2']) {
    const { port, ops } = fakePort({
      verifyToken: () => Promise.resolve({ sub: OWNER_ID, role: 'authenticated', aal }),
    })
    await failsWith(authorise(request(`Bearer ${TOKEN}`), port), 'mfa_required')
    assertEquals(ops(), ['verifyToken'])
  }
})

Deno.test('authorise: an ended session or banned user is 401', async () => {
  const { port, ops } = fakePort({ sessionUserId: () => Promise.reject(new HttpError('unauthorized')) })
  await failsWith(authorise(request(`Bearer ${TOKEN}`), port), 'unauthorized')
  assertEquals(ops(), ['verifyToken', 'sessionUserId'])
})

Deno.test('authorise: getUser must agree with the token subject', async () => {
  const { port } = fakePort({ sessionUserId: () => Promise.resolve(CLUB_ID) })
  await failsWith(authorise(request(`Bearer ${TOKEN}`), port), 'unauthorized')
})

Deno.test('authorise: an aal2 club account is 403 forbidden', async () => {
  const { port } = fakePort({
    verifyToken: () => Promise.resolve({ sub: CLUB_ID, role: 'authenticated', aal: 'aal2' }),
    sessionUserId: () => Promise.resolve(CLUB_ID),
  })
  await failsWith(authorise(request(`Bearer ${TOKEN}`), port), 'forbidden')
})
