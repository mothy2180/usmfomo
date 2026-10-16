// Account passwords: the rules an owner-typed password must meet, and the
// suggestion the owner console offers. Supabase Auth enforces the same floor
// (config.toml: minimum_password_length = 12, password_requirements =
// lower_upper_letters_digits); bcrypt only reads the first 72 bytes, so a
// longer password would be cut without anyone noticing.
//
// supabase/functions/_shared/validate.ts (password) and _shared/password.ts
// (the server's generator) mirror this file, which the Edge runtime cannot
// import; their tests compare both against the same inputs.

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_BYTES = 72

export type PasswordRule = 'length' | 'lower' | 'upper' | 'digit' | 'max_bytes' | 'no_control'

/** Every rule in checklist order, with the words the console shows. */
export const PASSWORD_RULES: ReadonlyArray<{ rule: PasswordRule; label: string }> = [
  { rule: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters` },
  { rule: 'lower', label: 'A lowercase letter (a–z)' },
  { rule: 'upper', label: 'An uppercase letter (A–Z)' },
  { rule: 'digit', label: 'A digit (0–9)' },
  { rule: 'max_bytes', label: `At most ${PASSWORD_MAX_BYTES} bytes (about ${PASSWORD_MAX_BYTES} plain characters)` },
  { rule: 'no_control', label: 'No tabs, line breaks or other control characters' },
]

const NO_CONTROL = /^[^\p{Cc}]*$/u

/** Which rules the password meets. Nothing is trimmed: spaces count as typed. */
export function passwordChecks(password: string): Record<PasswordRule, boolean> {
  return {
    length: [...password].length >= PASSWORD_MIN_LENGTH,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    max_bytes: new TextEncoder().encode(password).byteLength <= PASSWORD_MAX_BYTES,
    no_control: NO_CONTROL.test(password),
  }
}

/** The rules the password breaks, in checklist order (empty when it is acceptable). */
export function passwordProblems(password: string): PasswordRule[] {
  const checks = passwordChecks(password)
  return PASSWORD_RULES.map((r) => r.rule).filter((rule) => !checks[rule])
}

// ---------------------------------------------------------------------------
// Suggestions: the same alphabet, length and sampling as the server's
// generatePassword (supabase/functions/_shared/password.ts).
// ---------------------------------------------------------------------------

export const SUGGESTED_PASSWORD_LENGTH = 24
export const SUGGESTED_PASSWORD_ALPHABET =
  'abcdefghijkmnopqrstuvwxyz' + 'ABCDEFGHJKLMNPQRSTUVWXYZ' + '23456789'

/** Fills the array with random bytes and returns it (crypto.getRandomValues). */
export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

const secureFill: RandomFill = (bytes) => crypto.getRandomValues(bytes)

// Rejection sampling keeps every character equally likely; a candidate that
// lacks a class is dropped whole, so the result stays uniform.
const SAMPLE_LIMIT = 256 - (256 % SUGGESTED_PASSWORD_ALPHABET.length)
const DRAW_BYTES = 48
const MAX_DRAWS = 100

/** A random 24-character password without look-alikes (0 O 1 l I) that meets every rule. */
export function suggestPassword(fill: RandomFill = secureFill): string {
  let candidate = ''
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    for (const byte of fill(new Uint8Array(DRAW_BYTES))) {
      if (byte >= SAMPLE_LIMIT) continue
      candidate += SUGGESTED_PASSWORD_ALPHABET[byte % SUGGESTED_PASSWORD_ALPHABET.length]
      if (candidate.length < SUGGESTED_PASSWORD_LENGTH) continue
      if (passwordProblems(candidate).length === 0) return candidate
      candidate = ''
    }
  }
  throw new Error('password generator failed')
}
