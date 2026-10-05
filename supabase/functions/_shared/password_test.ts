import { assert, assertEquals, assertThrows } from '@std/assert'
import {
  generatePassword,
  hasRequiredClasses,
  PASSWORD_ALPHABET,
  PASSWORD_DIGITS,
  PASSWORD_LENGTH,
  PASSWORD_LOWER,
  PASSWORD_UPPER,
  type RandomFill,
} from './password.ts'

const LOOK_ALIKES = ['0', 'O', '1', 'l', 'I']

Deno.test('alphabet: lower, upper and digits without look-alikes', () => {
  for (const c of LOOK_ALIKES) assert(!PASSWORD_ALPHABET.includes(c), `alphabet contains ${c}`)
  assertEquals(new Set(PASSWORD_ALPHABET).size, PASSWORD_ALPHABET.length)
  assert(/^[a-z]+$/.test(PASSWORD_LOWER))
  assert(/^[A-Z]+$/.test(PASSWORD_UPPER))
  assert(/^[2-9]+$/.test(PASSWORD_DIGITS))
})

Deno.test('generatePassword: 24 characters, every class, alphabet only', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 2000; i++) {
    const pw = generatePassword()
    assertEquals(pw.length, PASSWORD_LENGTH)
    assert(hasRequiredClasses(pw), pw)
    for (const c of pw) assert(PASSWORD_ALPHABET.includes(c), `unexpected ${c}`)
    seen.add(pw)
  }
  assertEquals(seen.size, 2000)
})

Deno.test('generatePassword: maps bytes onto the alphabet and skips biased bytes', () => {
  // 57 symbols, so bytes >= 228 (= 4 * 57) are skipped: unbiased rejection sampling.
  assertEquals(PASSWORD_ALPHABET.length, 57)
  const sequence = [255, 228, 0, 25, 49, 1, 26, 50, 227]
  const fill: RandomFill = (buf) => {
    for (let i = 0; i < buf.length; i++) buf[i] = sequence[i % sequence.length]
    return buf
  }
  // 0 -> a, 25 -> A, 49 -> 2, 1 -> b, 26 -> B, 50 -> 3, 227 -> 9
  assertEquals(generatePassword(fill), 'aA2bB39aA2bB39aA2bB39aA2')
})

Deno.test('generatePassword: redraws a password missing a class', () => {
  // First 48 bytes: only lowercase letters; afterwards a full mix.
  let round = 0
  const fill: RandomFill = (buf) => {
    for (let i = 0; i < buf.length; i++) buf[i] = round === 0 ? i % 25 : (i * 7) % 57
    round++
    return buf
  }
  const pw = generatePassword(fill)
  assert(hasRequiredClasses(pw))
  assert(round >= 2)
})

Deno.test('generatePassword: a broken random source fails instead of looping', () => {
  assertThrows(() => generatePassword((buf) => buf.fill(0)), Error, 'password generator failed')
  assertThrows(() => generatePassword((buf) => buf.fill(255)), Error, 'password generator failed')
})

Deno.test('hasRequiredClasses', () => {
  assertEquals(hasRequiredClasses('abcABC234'), true)
  assertEquals(hasRequiredClasses('abcdefgh'), false)
  assertEquals(hasRequiredClasses('ABC234'), false)
  assertEquals(hasRequiredClasses('abcABC'), false)
})
