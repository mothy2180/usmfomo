import { assertEquals } from '@std/assert'
// The source of truth for the rules mirrored in validate.ts. Importing it here
// (test only; the Edge runtime cannot) keeps both from drifting apart.
import {
  ACCOUNT_EMAIL_DOMAIN as SHARED_DOMAIN,
  CAMPUSES as SHARED_CAMPUSES,
  ORG_TYPES as SHARED_ORG_TYPES,
} from '../../../packages/shared/src/config.ts'
import {
  createAccountSchema,
  orgNameSchema,
  orgSlugSchema,
  usernameSchema,
} from '../../../packages/shared/src/schemas.ts'
import { usernameToEmail as sharedUsernameToEmail } from '../../../packages/shared/src/supabase.ts'
import * as v from './validate.ts'

const USERNAMES = [
  'csoc',
  'robotics-club',
  ' Robotics-Club ',
  'ab',
  'abc',
  'a'.repeat(32),
  'a'.repeat(33),
  '-abc',
  'abc-',
  'a_b',
  'ab c',
  'ÄBC',
  'abc\n',
  '',
  '123',
  'a--b',
  42,
  null,
  undefined,
  ['abc'],
]
const SLUGS = [
  'a',
  'ab',
  'robotics-club',
  ' Robotics-Club ',
  '-a',
  'a-',
  'a'.repeat(50),
  'a'.repeat(51),
  'a b',
  'a.b',
  '',
  'école',
  7,
  null,
]
const ORG_NAMES = [
  'CS',
  'C',
  '  CS  ',
  'Computer Science Society',
  'x'.repeat(100),
  'x'.repeat(101),
  'tab\there',
  'line\nbreak',
  'Kelab Bahasa & Budaya',
  'Persatuan 😀',
  '',
  '   ',
  3,
  null,
]

Deno.test('username() matches usernameSchema', () => {
  for (const input of USERNAMES) {
    const shared = usernameSchema.safeParse(input)
    assertEquals(v.username(input), shared.success ? shared.data : null, JSON.stringify(input))
  }
})

Deno.test('orgSlug() matches orgSlugSchema', () => {
  for (const input of SLUGS) {
    const shared = orgSlugSchema.safeParse(input)
    assertEquals(v.orgSlug(input), shared.success ? shared.data : null, JSON.stringify(input))
  }
})

Deno.test('orgName() matches orgNameSchema', () => {
  for (const input of ORG_NAMES) {
    const shared = orgNameSchema.safeParse(input)
    assertEquals(v.orgName(input), shared.success ? shared.data : null, JSON.stringify(input))
  }
})

Deno.test('type and campus rules match createAccountSchema', () => {
  const base = { username: 'csoc', orgName: 'CS Society', orgSlug: 'cs-society' }
  for (const type of ['club', 'school', 'Club', 'society', '', null]) {
    for (const campus of ['main', 'engineering', 'health', 'other', 'online', 'Main', 'penang', null]) {
      const shared = createAccountSchema.safeParse({ ...base, type, campus })
      const local = v.orgType(type) !== null && v.orgCampus(campus) !== null
      assertEquals(local, shared.success, `${type}/${campus}`)
    }
  }
})

Deno.test('constants match packages/shared/src/config.ts', () => {
  assertEquals(v.ACCOUNT_EMAIL_DOMAIN, SHARED_DOMAIN)
  assertEquals([...v.CAMPUSES], [...SHARED_CAMPUSES])
  assertEquals([...v.ORG_TYPES], [...SHARED_ORG_TYPES])
  for (const name of ['csoc', ' Robotics-Club ']) assertEquals(v.usernameToEmail(name), sharedUsernameToEmail(name))
})

Deno.test('uuid(): canonical UUIDs only, lower-cased', () => {
  assertEquals(v.uuid('11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111')
  assertEquals(v.uuid('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  for (
    const bad of [
      '',
      'x',
      '11111111111141118111111111111111',
      '{11111111-1111-4111-8111-111111111111}',
      ' 11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-11111111111g',
      1,
      null,
      undefined,
    ]
  ) {
    assertEquals(v.uuid(bad), null, String(bad))
  }
})

Deno.test('bool(): real booleans only', () => {
  assertEquals(v.bool(true), true)
  assertEquals(v.bool(false), false)
  for (const bad of ['true', 'false', 1, 0, null, undefined]) assertEquals(v.bool(bad), null, String(bad))
})
