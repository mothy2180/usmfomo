import { assertEquals } from '@std/assert'
import { MIN_SECRET_LENGTH, secretMatches, timingSafeEqual } from './crypto.ts'

const bytes = (...values: number[]) => new Uint8Array(values)
const SECRET = 'a'.repeat(MIN_SECRET_LENGTH) + '-local-test-secret'

Deno.test('timingSafeEqual: equal arrays', () => {
  assertEquals(timingSafeEqual(bytes(1, 2, 3), bytes(1, 2, 3)), true)
  assertEquals(timingSafeEqual(new Uint8Array(0), new Uint8Array(0)), true)
})

Deno.test('timingSafeEqual: any differing byte, including the last', () => {
  assertEquals(timingSafeEqual(bytes(1, 2, 3), bytes(0, 2, 3)), false)
  assertEquals(timingSafeEqual(bytes(1, 2, 3), bytes(1, 2, 4)), false)
})

Deno.test('timingSafeEqual: different lengths are unequal', () => {
  assertEquals(timingSafeEqual(bytes(1, 2, 3), bytes(1, 2)), false)
  assertEquals(timingSafeEqual(bytes(1, 2), bytes(1, 2, 0)), false)
})

Deno.test('secretMatches: only the exact secret matches', async () => {
  assertEquals(await secretMatches(SECRET, SECRET), true)
  assertEquals(await secretMatches(SECRET + ' ', SECRET), false)
  assertEquals(await secretMatches(SECRET.slice(0, -1), SECRET), false)
  assertEquals(await secretMatches(SECRET.toUpperCase(), SECRET), false)
  assertEquals(await secretMatches('', SECRET), false)
  assertEquals(await secretMatches(null, SECRET), false)
})

Deno.test('secretMatches: an unset or short configured secret never matches', async () => {
  assertEquals(await secretMatches('', undefined), false)
  assertEquals(await secretMatches(null, undefined), false)
  assertEquals(await secretMatches('', ''), false)
  const short = 'x'.repeat(MIN_SECRET_LENGTH - 1)
  assertEquals(await secretMatches(short, short), false)
})
