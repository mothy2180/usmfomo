import { describe, expect, it } from 'vitest'
import {
  PASSWORD_RULES,
  passwordChecks,
  passwordProblems,
  suggestPassword,
  SUGGESTED_PASSWORD_ALPHABET,
  SUGGESTED_PASSWORD_LENGTH,
  type RandomFill,
} from './password.ts'

describe('password rules', () => {
  it('accepts 12+ characters with a lowercase letter, an uppercase letter and a digit', () => {
    for (const ok of ['abcdefghiJK1', 'Correct Horse 9 Battery', 'Ünïcödé-Passw0rd', 'aB3'.repeat(24)]) {
      expect(passwordProblems(ok), ok).toEqual([])
    }
  })

  it('names every broken rule in checklist order', () => {
    expect(passwordProblems('')).toEqual(['length', 'lower', 'upper', 'digit'])
    expect(passwordProblems('abcdefghiJK')).toEqual(['length', 'digit'])
    expect(passwordProblems('ABCDEFGHIJK1')).toEqual(['lower'])
    expect(passwordProblems('abcdefghijk1')).toEqual(['upper'])
    expect(passwordProblems('abcdefghiJKl')).toEqual(['digit'])
    expect(passwordProblems('abcdefghiJK1\t')).toEqual(['no_control'])
    expect(passwordProblems('abcdefghiJK1\n')).toEqual(['no_control'])
    // 73 bytes: bcrypt would silently ignore the end.
    expect(passwordProblems('aB3'.repeat(24) + 'x')).toEqual(['max_bytes'])
    // '€' is 3 bytes: with 9 of them (30 bytes) all is fine, 24 of them make 75 bytes.
    expect(passwordProblems('aB3' + '€'.repeat(9))).toEqual([])
    expect(passwordProblems('aB3' + '€'.repeat(24))).toEqual(['max_bytes'])
  })

  it('counts characters, not UTF-16 units, and trims nothing', () => {
    // 11 characters, one of them outside the BMP (2 UTF-16 units).
    expect(passwordChecks('aB3😀aaaaaaa').length).toBe(false)
    expect(passwordChecks(' aB3aaaaaaa ').length).toBe(true)
  })

  it('every rule has a label', () => {
    expect(PASSWORD_RULES.map((r) => r.rule)).toEqual(Object.keys(passwordChecks('')))
    for (const r of PASSWORD_RULES) expect(r.label.length).toBeGreaterThan(5)
  })
})

describe('suggestPassword', () => {
  it('24 characters from the alphabet, meeting every rule', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const pw = suggestPassword()
      expect(pw).toHaveLength(SUGGESTED_PASSWORD_LENGTH)
      expect(passwordProblems(pw)).toEqual([])
      for (const c of pw) expect(SUGGESTED_PASSWORD_ALPHABET).toContain(c)
      seen.add(pw)
    }
    expect(seen.size).toBe(500)
    for (const c of ['0', 'O', '1', 'l', 'I']) expect(SUGGESTED_PASSWORD_ALPHABET).not.toContain(c)
  })

  it('maps bytes onto the alphabet and skips biased ones', () => {
    const sequence = [255, 228, 0, 25, 49, 1, 26, 50, 227]
    const fill: RandomFill = (buf) => {
      for (let i = 0; i < buf.length; i++) buf[i] = sequence[i % sequence.length]!
      return buf
    }
    expect(suggestPassword(fill)).toBe('aA2bB39aA2bB39aA2bB39aA2')
  })

  it('a broken random source fails instead of looping', () => {
    expect(() => suggestPassword((buf) => buf.fill(0))).toThrow('password generator failed')
  })
})
