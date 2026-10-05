import { assertEquals, assertThrows } from '@std/assert'
import { HttpError } from '../_shared/http.ts'
import { MAX_BODY_BYTES, parseActionBody, parseActionRequest } from './request.ts'

const U = '11111111-1111-4111-8111-111111111111'

function rejects(body: unknown) {
  const err = assertThrows(() => parseActionRequest(body), HttpError)
  assertEquals(err.code, 'bad_request')
}

Deno.test('parameterless actions', () => {
  assertEquals(parseActionRequest({ action: 'status' }), { action: 'status' })
  assertEquals(parseActionRequest({ action: 'list_accounts', extra: 1 }), { action: 'list_accounts' })
})

Deno.test('create_account: normalises like createAccountSchema', () => {
  assertEquals(
    parseActionRequest({
      action: 'create_account',
      username: ' CSoc ',
      orgName: '  Computer Science Society ',
      orgSlug: 'CS-Society',
      type: 'club',
      campus: 'main',
    }),
    {
      action: 'create_account',
      username: 'csoc',
      orgName: 'Computer Science Society',
      orgSlug: 'cs-society',
      type: 'club',
      campus: 'main',
    },
  )
})

Deno.test('create_account: every field is required and checked', () => {
  const ok = {
    action: 'create_account',
    username: 'csoc',
    orgName: 'CS Soc',
    orgSlug: 'cs-soc',
    type: 'club',
    campus: 'main',
  }
  parseActionRequest(ok)
  for (
    const [field, bad] of [
      ['username', 'a'],
      ['username', 'has space'],
      ['username', undefined],
      ['orgName', 'x'],
      ['orgName', 'bad\u0007bell'],
      ['orgName', 'x'.repeat(101)],
      ['orgSlug', '-bad'],
      ['orgSlug', 'with space'],
      ['type', 'society'],
      ['campus', 'online'],
      ['campus', 'penang'],
      ['campus', undefined],
    ] as const
  ) {
    rejects({ ...ok, [field]: bad })
  }
})

Deno.test('userId actions', () => {
  for (const action of ['reset_password', 'handover', 'remove_factors', 'delete_account']) {
    assertEquals<unknown>(parseActionRequest({ action, userId: U.toUpperCase() }), { action, userId: U })
    rejects({ action })
    rejects({ action, userId: 'not-a-uuid' })
    rejects({ action, userId: 42 })
  }
})

Deno.test('set_account_active: needs a real boolean', () => {
  assertEquals(parseActionRequest({ action: 'set_account_active', userId: U, active: false }), {
    action: 'set_account_active',
    userId: U,
    active: false,
  })
  rejects({ action: 'set_account_active', userId: U })
  rejects({ action: 'set_account_active', userId: U, active: 'false' })
  rejects({ action: 'set_account_active', userId: U, active: 0 })
})

Deno.test('update_org: all fields', () => {
  const ok = {
    action: 'update_org',
    orgId: U,
    name: 'Robotics Club',
    slug: 'robotics',
    type: 'school',
    campus: 'health',
    active: true,
  }
  assertEquals<unknown>(parseActionRequest(ok), ok)
  for (
    const [field, bad] of [
      ['orgId', 'x'],
      ['name', ''],
      ['slug', 'Bad Slug'],
      ['type', 'Club'],
      ['campus', 'online'],
      ['active', 'yes'],
      ['active', undefined],
    ] as const
  ) {
    rejects({ ...ok, [field]: bad })
  }
})

Deno.test('postId actions', () => {
  for (const action of ['delete_post', 'remove_post_image']) {
    assertEquals<unknown>(parseActionRequest({ action, postId: U }), { action, postId: U })
    rejects({ action, postId: '' })
    rejects({ action, userId: U })
  }
})

Deno.test('unknown actions and non-object bodies', () => {
  for (
    const body of [
      null,
      undefined,
      1,
      'status',
      [],
      [{ action: 'status' }],
      {},
      { action: 'drop_tables' },
      { action: 'STATUS' },
      { action: 'toString' },
      { action: '__proto__' },
    ]
  ) {
    rejects(body)
  }
})

Deno.test('parseActionBody: JSON only, size-limited', () => {
  assertEquals(parseActionBody('{"action":"status"}'), { action: 'status' })
  for (const text of ['', 'not json', '{"action":', 'null']) {
    const err = assertThrows(() => parseActionBody(text), HttpError)
    assertEquals(err.code, 'bad_request')
  }
  const big = JSON.stringify({ action: 'status', pad: 'x'.repeat(MAX_BODY_BYTES) })
  assertEquals(assertThrows(() => parseActionBody(big), HttpError).code, 'bad_request')
})
